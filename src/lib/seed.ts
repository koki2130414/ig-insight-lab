import type { Db } from "./db";
import { DEFAULT_ROLES, DEFAULT_TARGETS, type Format } from "./catalog";
import { addDays, jstDay, weekStart } from "./time";

export const LOCAL_USER = "local";

const HANDLES = { personal: "_ko_213", farm: "213nouen" } as const;
const NAMES = { personal: "新見康樹", farm: "にいみ農園" } as const;

export async function ensureSeed(db: Db) {
  await db.query(`INSERT INTO app_users(id,name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [LOCAL_USER, "新見康樹"]);
  for (const dataset of ["real", "demo"] as const) {
    for (const kind of ["personal", "farm"] as const) {
      const existing = await db.query(`SELECT id FROM accounts WHERE user_id=$1 AND dataset=$2 AND kind=$3`, [LOCAL_USER, dataset, kind]);
      if (existing.length) continue;
      const [acc] = await db.query<{ id: string }>(
        `INSERT INTO accounts(user_id,dataset,kind,handle,display_name,roles,follower_target,weekly_minutes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [LOCAL_USER, dataset, kind, HANDLES[kind], NAMES[kind], DEFAULT_ROLES[kind], kind === "farm" ? 10000 : null, kind === "farm" ? 240 : 180],
      );
      for (const t of DEFAULT_TARGETS[kind]) {
        await db.query(
          `INSERT INTO targets(account_id,layer,name,needs,value_prop,themes,desired_action,monetization,priority,validation_method,is_hypothesis)
           VALUES ($1,'desired',$2,$3,$4,$5,$6,$7,$8,$9,true)`,
          [acc.id, t.name, t.needs, t.value_prop, t.themes, t.desired_action, t.monetization, t.priority, t.validation_method],
        );
      }
      if (dataset === "demo") await seedDemo(db, acc.id, kind);
    }
  }
}

/** 決定的な擬似乱数（デモの再現性のため） */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export async function seedDemo(db: Db, accountId: string, kind: "personal" | "farm") {
  const r = rng(kind === "farm" ? 213 : 42);
  const today = jstDay();
  const base = kind === "farm" ? 1850 : 1320;
  const themes = kind === "farm"
    ? ["米づくりの裏側", "父との農作業", "生産者が伝える米の選び方", "収穫から食卓まで", "農業体験", "若者が家業を継ぐ挑戦", "直販や地域連携の試行錯誤"]
    : ["挑戦の裏側", "イベント運営", "教育への思い", "サッカーとメンタル", "地域の人との対話", "家業と自分の夢"];
  const purposes = kind === "farm" ? ["trust", "purchase", "awareness", "experience", "follow"] : ["relationship", "awareness", "trust", "follow"];
  const formats: Format[] = ["reel", "reel", "carousel", "feed", "reel", "story"];
  const hooks = kind === "farm"
    ? ["この田んぼ、父と2人で管理しています", "スーパーの米と何が違う？生産者が答えます", "新米の炊き方、これだけは守って", "稲刈りの1日を30秒で", "家業を継ぐと決めた日の話"]
    : ["大学を休学して、今やっていること", "失敗したイベントの話をします", "地元でコミュニティを作る理由", "20代で3つの事業に関わって分かったこと"];

  const targets = await db.query<{ id: string }>(`SELECT id FROM targets WHERE account_id=$1 ORDER BY priority`, [accountId]);
  const postIds: string[] = [];
  for (let i = 0; i < 26; i++) {
    const daysAgo = 2 + Math.floor(i * 2.2 + r() * 2);
    const hour = [7, 12, 18, 20, 21][Math.floor(r() * 5)];
    const postedAt = new Date(addDays(today, -daysAgo) + `T${String(hour).padStart(2, "0")}:00:00+09:00`);
    const format = formats[Math.floor(r() * formats.length)];
    const theme = themes[Math.floor(r() * themes.length)];
    const [p] = await db.query<{ id: string }>(
      `INSERT INTO posts(account_id,external_id,url,posted_at,format,theme,target_id,purpose,hook,duration_sec,structure,caption,cta,collaborator,is_ad,is_giveaway,production_minutes,production_cost,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'demo') RETURNING id`,
      [
        accountId, `demo-${kind}-${i}`, `https://www.instagram.com/p/DEMO${kind.toUpperCase()}${i}/`, postedAt, format, theme,
        targets[Math.floor(r() * targets.length)]?.id ?? null, purposes[Math.floor(r() * purposes.length)],
        format === "story" ? null : hooks[Math.floor(r() * hooks.length)],
        format === "reel" ? Math.round(12 + r() * 50) : null,
        format === "reel" ? "フック→現場→一言→CTA" : format === "carousel" ? "表紙→要点3枚→まとめ" : null,
        `（デモ）${theme}についての投稿`, r() > 0.5 ? "プロフィールのリンクから" : "保存して見返してね",
        r() > 0.85 ? "地元カフェ（デモ）" : null, r() > 0.92, r() > 0.95,
        Math.round(30 + r() * 120), r() > 0.8 ? Math.round(r() * 3000) : 0,
      ],
    );
    postIds.push(p.id);
    const reachBase = (format === "reel" ? 900 : format === "story" ? 250 : 500) * (0.5 + r() * 1.6);
    for (const [cp, hours, mult] of [["24h", 24, 0.55], ["72h", 72, 0.85], ["7d", 168, 1]] as const) {
      if (daysAgo * 24 < hours) continue;
      const reach = Math.round(reachBase * mult);
      const reelLike = format !== "story";
      await db.query(
        `INSERT INTO post_metrics(post_id,account_id,checkpoint,captured_at,hours_since_post,source,measurement,reach,views,likes,comments,saves,shares,profile_visits,follows,non_follower_reach,avg_watch_sec)
         VALUES ($1,$2,$3,$4,$5,'demo','measured',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          p.id, accountId, cp, new Date(postedAt.getTime() + hours * 3600000), hours,
          reach, Math.round(reach * (1.3 + r())),
          reelLike ? Math.round(reach * (0.04 + r() * 0.06)) : null,
          reelLike ? Math.round(reach * r() * 0.012) : null,
          reelLike ? Math.round(reach * (0.005 + r() * 0.03)) : null,
          Math.round(reach * r() * 0.015),
          // リールの投稿単位プロフィール訪問・フォローはAPI非対応 → デモでも一部を未取得(null)にする
          format === "reel" && r() > 0.5 ? null : Math.round(reach * (0.01 + r() * 0.03)),
          format === "reel" && r() > 0.5 ? null : Math.round(reach * r() * 0.006),
          r() > 0.3 ? Math.round(reach * (0.3 + r() * 0.5)) : null,
          format === "reel" ? Math.round((4 + r() * 10) * 10) / 10 : null,
        ],
      );
    }
  }

  // 週次のアカウント指標（月〜日）
  let followers = base;
  for (let w = 8; w >= 1; w--) {
    const start = addDays(weekStart(today), -7 * w);
    const end = addDays(start, 6);
    const net = Math.round(-5 + r() * 45);
    followers += net;
    const reach = Math.round((kind === "farm" ? 3200 : 2400) * (0.6 + r()));
    const values: Record<string, number | null> = {
      followers, follower_net: net, reach, reach_non_follower: Math.round(reach * (0.35 + r() * 0.3)),
      views: Math.round(reach * (2 + r())), accounts_engaged: Math.round(reach * (0.06 + r() * 0.05)),
      saves: Math.round(reach * 0.012), shares: Math.round(reach * 0.006), comments: Math.round(reach * 0.004),
      profile_visits: w % 3 === 0 ? null : Math.round(reach * 0.03), link_taps: Math.round(reach * 0.004 + r() * 6),
      line_signups: kind === "farm" ? Math.round(r() * 6) : null, site_sessions: null,
    };
    for (const [metric, value] of Object.entries(values)) {
      await db.query(
        `INSERT INTO account_metrics(account_id,metric,period_start,period_end,value,status,source,measurement,captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,'demo','measured',$7)`,
        [accountId, metric, start, end, value, value === null ? "not_entered" : "ok", new Date(end + "T23:00:00+09:00")],
      );
    }
  }

  // オーディエンス集計（取得できた想定のものだけ。engaged は未取得のまま）
  const cap = new Date();
  const tf = "this_month";
  const ages = kind === "farm" ? [["18-24", 9], ["25-34", 24], ["35-44", 31], ["45-54", 21], ["55-64", 10], ["65+", 5]] : [["18-24", 34], ["25-34", 38], ["35-44", 15], ["45-54", 8], ["55-64", 3], ["65+", 2]];
  for (const [b, v] of ages) await db.query(`INSERT INTO audience_aggregates(account_id,segment,dimension,bucket,value,unit,timeframe,source,captured_at) VALUES ($1,'followers','age',$2,$3,'percent',$4,'demo',$5)`, [accountId, b, v, tf, cap]);
  for (const [b, v] of [["女性", kind === "farm" ? 61 : 44], ["男性", kind === "farm" ? 37 : 54], ["不明", 2]] as const) await db.query(`INSERT INTO audience_aggregates(account_id,segment,dimension,bucket,value,unit,timeframe,source,captured_at) VALUES ($1,'followers','gender',$2,$3,'percent',$4,'demo',$5)`, [accountId, b, v, tf, cap]);
  for (const [b, v] of [["下野市", 18], ["宇都宮市", 22], ["小山市", 9], ["東京都内", 17], ["その他", 34]] as const) await db.query(`INSERT INTO audience_aggregates(account_id,segment,dimension,bucket,value,unit,timeframe,source,captured_at) VALUES ($1,'followers','city',$2,$3,'percent',$4,'demo',$5)`, [accountId, b, v, tf, cap]);
  for (const [b, v] of [["宇都宮市", 14], ["東京都内", 25], ["下野市", 8], ["その他", 53]] as const) await db.query(`INSERT INTO audience_aggregates(account_id,segment,dimension,bucket,value,unit,timeframe,source,captured_at) VALUES ($1,'reached','city',$2,$3,'percent',$4,'demo',$5)`, [accountId, b, v, tf, cap]);

  // 本人提供サンプル（架空の人物）
  const bios = kind === "farm"
    ? ["2児のママ。毎日のお弁当づくり記録", "宇都宮でカフェを経営しています", "料理とキャンプが好き", "栃木の地域おこし協力隊", "", "小学校の先生。食育に関心あり", "写真とごはん", "就農2年目の野菜農家", "", "東京在住、実家は栃木"]
    : ["大学3年 / 起業準備中", "サッカーコーチ（U-12）", "栃木で飲食店を経営", "", "動画編集フリーランス", "塾講師をしています", "地方創生に関わりたい学生", "", "株式会社代表。地域×教育", "YouTubeで発信中"];
  for (let i = 0; i < bios.length; i++) {
    const [pp] = await db.query<{ id: string }>(
      `INSERT INTO audience_people(account_id,segment,handle,bio,survey_answer,selection_method,source) VALUES ($1,$2,$3,$4,$5,$6,'demo') RETURNING id`,
      [accountId, i < 6 ? "commenter" : "survey", `demo_user_${kind}_${i}`, bios[i] || null, i >= 6 ? (kind === "farm" ? "お米を買う理由: 生産者が分かるから" : "知ったきっかけ: イベント") : null,
        i < 6 ? "直近30日に2回以上コメントした人（デモ）" : "購入者アンケート回答者（デモ）"],
    );
    if (i === 1 || i === 8) await db.query(`INSERT INTO person_tags(person_id,category,basis,evidence,confirmed) VALUES ($1,'business','manual','本人と面識あり（デモ）',true)`, [pp.id]);
  }

  // 施策（状態ごとに1件以上）
  const sampleStatuses = ["idea", "idea", "producing", "posted", "measuring", "reviewed"] as const;
  for (let i = 0; i < sampleStatuses.length; i++) {
    const st = sampleStatuses[i];
    const title = kind === "farm"
      ? ["新米の炊き方を父が解説（冒頭の言葉を変える）", "稲刈り体験の参加者の声", "米袋ができるまで（尺を短くする）", "生産者が伝える米の選び方", "父との田植え（顔出しあり）", "収穫から食卓まで（CTAをLINEに）"][i]
      : ["休学中の1日（冒頭の言葉を変える）", "イベント失敗談", "地域の経営者との対談", "挑戦の裏側（テロップ多め）", "BUZZ BASE準備の裏側", "家業と夢の両立"][i];
    await db.query(
      `INSERT INTO initiatives(account_id,title,status,target_id,goal,format,hypothesis,hooks,primary_metric,success_criteria,stop_criteria,est_minutes,est_cost,test_variable,generated_by,post_id,decision,result_summary,planned_week)
       VALUES ($1,$2,$3,$4,$5,'reel',$6,$7,'save_rate',$8,$9,$10,0,$11,'manual',$12,$13,$14,$15)`,
      [accountId, `（デモ）${title}`, st, targets[i % targets.length]?.id ?? null, kind === "farm" ? "purchase" : "relationship",
        "生産者本人が具体的な手順を話すと、保存されやすい（比較検証で確認）",
        ["冒頭案A（デモ）", "冒頭案B（デモ）", "冒頭案C（デモ）"],
        "同形式・72時間時点の保存率中央値を上回る", "2回続けて中央値の半分未満なら終了", 90,
        ["hook", "duration", "face", "cta"][i % 4],
        st === "posted" || st === "measuring" || st === "reviewed" ? postIds[i] : null,
        st === "reviewed" ? "retest" : null,
        st === "reviewed" ? "保存率は中央値を上回ったが1回のみ。季節要因（新米時期）もあるため再検証" : null,
        weekStart(today)],
    );
  }

  const [ini] = await db.query<{ id: string }>(`SELECT id FROM initiatives WHERE account_id=$1 AND status='reviewed' LIMIT 1`, [accountId]);
  const convs = kind === "farm"
    ? [["purchase", 2, 9800, "measured"], ["purchase", 1, 4900, "self_reported"], ["line_signup", 1, null, "measured"], ["experience", 3, 9000, "unknown_path"], ["inquiry", 1, null, "self_reported"]]
    : [["partnership", 1, null, "self_reported"], ["inquiry", 2, null, "measured"]];
  let n = 0;
  for (const [k, q, rev, attr] of convs) {
    await db.query(
      `INSERT INTO conversions(account_id,occurred_at,kind,quantity,revenue,gross_profit,attribution,initiative_id,external_ref,note,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'デモデータ','demo')`,
      [accountId, new Date(addDays(today, -3 - n * 4) + "T15:00:00+09:00"), k, q, rev, rev ? Math.round(Number(rev) * 0.35) : null, attr, attr === "measured" ? ini?.id ?? null : null, `demo-${kind}-${n}`],
    );
    n++;
  }
  if (ini) {
    await db.query(`INSERT INTO costs(account_id,initiative_id,category,amount,occurred_on,note) VALUES ($1,$2,'production',3000,$3,'デモ: 撮影補助')`, [accountId, ini.id, addDays(today, -10)]);
    if (kind === "farm") await db.query(`INSERT INTO costs(account_id,initiative_id,category,amount,occurred_on,note) VALUES ($1,$2,'rice',1200,$3,'デモ: 試食用の米')`, [accountId, ini.id, addDays(today, -10)]);
  }
}

/** デモデータを初期状態に戻す（実データには触れない） */
export async function resetDemo(db: Db, userId: string) {
  await db.query(`DELETE FROM accounts WHERE user_id=$1 AND dataset='demo'`, [userId]);
  await ensureSeed(db);
}
