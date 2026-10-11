// 画面・計算・API で共有する定義。ここにない指標は作らない。
// API 対応状況は Meta 公式ドキュメント（2026-10-11 確認, Graph API v25.0）に基づく。docs/meta-api-research.md 参照。

export const FORMATS = {
  reel: "リール",
  feed: "フィード（単体）",
  carousel: "フィード（カルーセル）",
  story: "ストーリーズ",
} as const;
export type Format = keyof typeof FORMATS;

export const PURPOSES = {
  awareness: "届けたい人への認知",
  trust: "信頼づくり",
  follow: "フォロー獲得",
  inquiry: "問い合わせ",
  purchase: "お米の購入",
  experience: "農業体験への参加",
  relationship: "応援者・協業先との関係",
} as const;
export type Purpose = keyof typeof PURPOSES;

export const SOURCES = {
  api: "公式API",
  csv: "CSV取り込み",
  json: "JSON取り込み",
  manual: "手入力",
  demo: "デモデータ",
} as const;

export const MEASUREMENTS = {
  measured: "実測",
  manual: "手入力",
  estimated: "推定",
} as const;

export const CHECKPOINTS = {
  "24h": { label: "投稿後24時間", hours: 24 },
  "72h": { label: "投稿後72時間", hours: 72 },
  "7d": { label: "投稿後7日", hours: 168 },
  other: { label: "その他の時点", hours: null },
} as const;
export type Checkpoint = keyof typeof CHECKPOINTS;

export const STATUSES = {
  idea: "アイデア",
  producing: "制作中",
  posted: "投稿済み",
  measuring: "計測中",
  reviewed: "振り返り済み",
} as const;
export type Status = keyof typeof STATUSES;

export const DECISIONS = {
  retest: "再検証",
  continue: "継続",
  modify: "修正",
  stop: "終了",
} as const;

export const TEST_VARIABLES = {
  hook: "冒頭の言葉",
  duration: "動画尺",
  face: "顔出し",
  narration: "ナレーション",
  caption_overlay: "テロップ",
  theme: "テーマ",
  cta: "CTA",
  collab: "コラボ",
  post_time: "投稿時間",
} as const;

export const CONVERSION_KINDS = {
  line_signup: "LINE登録",
  inquiry: "問い合わせ",
  purchase: "購入",
  experience: "農業体験申込",
  partnership: "協業・相談",
} as const;

export const ATTRIBUTIONS = {
  measured: "計測できた成果",
  self_reported: "顧客の自己申告",
  unknown_path: "関連はあるが経路不明",
} as const;

export const COST_CATEGORIES = {
  production: "制作費",
  ads: "広告費",
  rice: "提供米（原価）",
  shipping: "送料",
  other: "その他",
} as const;

// 関心・職業カテゴリ（複数選択可）。センシティブ属性は含めない。
export const INTEREST_CATEGORIES = {
  food: "米・食・料理に関心",
  agri_local: "農業・地域活動に関心",
  education: "教育・子育てに関心",
  sports: "サッカー・スポーツに関心",
  business: "経営者・事業者",
  creator: "発信者・クリエイター",
  unknown: "分類できない",
} as const;
export type InterestCategory = keyof typeof INTEREST_CATEGORIES;

// 自己紹介・アンケートの文中キーワード → カテゴリ（推定扱い。根拠語を必ず保存）
export const CATEGORY_KEYWORDS: Record<Exclude<InterestCategory, "unknown">, string[]> = {
  food: ["料理", "ごはん", "ご飯", "お米", "米", "食", "レシピ", "グルメ", "弁当", "飲食", "カフェ", "キッチン"],
  agri_local: ["農業", "農家", "農園", "就農", "地域", "まちづくり", "地方創生", "栃木", "下野", "田んぼ", "野菜"],
  education: ["教育", "先生", "教師", "塾", "子育て", "ママ", "パパ", "保育", "学習", "受験"],
  sports: ["サッカー", "フットサル", "スポーツ", "部活", "コーチ", "トレーナー", "野球", "バスケ"],
  business: ["代表", "経営", "社長", "CEO", "起業", "創業", "事業", "オーナー", "店主", "取締役"],
  creator: ["発信", "クリエイター", "インフルエンサー", "YouTube", "TikTok", "写真", "カメラ", "デザイン", "ライター", "動画編集"],
};

export type MetricDef = {
  key: string;
  label: string;
  unit: "count" | "seconds" | "ratio" | "yen";
  definition: string;
  api: { name: string; formats?: Format[]; note?: string } | null;
  apiUnavailableReason?: string;
};

/** 投稿単位の指標 */
export const POST_METRICS: MetricDef[] = [
  { key: "reach", label: "リーチ", unit: "count", definition: "投稿を1回以上見たユニークアカウント数（Meta側の推定値）", api: { name: "reach", formats: ["reel", "feed", "carousel", "story"] } },
  { key: "views", label: "閲覧数", unit: "count", definition: "投稿が表示・再生された回数（同じ人の複数回を含む）", api: { name: "views", formats: ["reel", "feed", "carousel", "story"], note: "Meta上で in development 表記" } },
  { key: "likes", label: "いいね", unit: "count", definition: "いいね数（広告経由を除く）", api: { name: "likes", formats: ["reel", "feed", "carousel"] } },
  { key: "comments", label: "コメント", unit: "count", definition: "コメント数（広告経由を除く）", api: { name: "comments", formats: ["reel", "feed", "carousel"] } },
  { key: "saves", label: "保存", unit: "count", definition: "保存された回数", api: { name: "saved", formats: ["reel", "feed", "carousel"] } },
  { key: "shares", label: "シェア", unit: "count", definition: "シェアされた回数", api: { name: "shares", formats: ["reel", "feed", "carousel", "story"] } },
  { key: "profile_visits", label: "プロフィール訪問", unit: "count", definition: "この投稿からのプロフィール訪問数", api: { name: "profile_visits", formats: ["feed", "carousel", "story"], note: "リールはAPI非対応。アプリのインサイト画面から手入力" } },
  { key: "follows", label: "投稿由来フォロー", unit: "count", definition: "この投稿を見てフォローした数", api: { name: "follows", formats: ["feed", "carousel", "story"], note: "リールはAPI非対応。アプリのインサイト画面から手入力" } },
  { key: "non_follower_reach", label: "非フォロワーへのリーチ", unit: "count", definition: "リーチのうちフォロワー以外のアカウント数", api: null, apiUnavailableReason: "投稿単位のフォロワー/非フォロワー内訳はAPIの投稿インサイトに無い。アプリのインサイト画面の値を手入力" },
  { key: "avg_watch_sec", label: "平均視聴時間", unit: "seconds", definition: "リールの平均再生時間（秒）", api: { name: "ig_reels_avg_watch_time", formats: ["reel"], note: "APIはミリ秒で返る" } },
];

/** 投稿単位の率（分母が欠損・0のときは算出しない） */
export const POST_RATES = [
  { key: "save_rate", label: "保存率", num: "saves", den: "reach", definition: "保存数 ÷ リーチ" },
  { key: "share_rate", label: "シェア率", num: "shares", den: "reach", definition: "シェア数 ÷ リーチ" },
  { key: "follow_rate", label: "投稿由来フォロー率", num: "follows", den: "reach", definition: "投稿由来フォロー数 ÷ リーチ" },
  { key: "profile_rate", label: "プロフィール訪問率", num: "profile_visits", den: "reach", definition: "プロフィール訪問 ÷ リーチ" },
  { key: "non_follower_ratio", label: "非フォロワー到達割合", num: "non_follower_reach", den: "reach", definition: "非フォロワーへのリーチ ÷ リーチ" },
] as const;

/** アカウント単位の期間指標 */
export const ACCOUNT_METRICS: MetricDef[] = [
  { key: "followers", label: "フォロワー数（期間末時点）", unit: "count", definition: "期間末日時点のフォロワー数。APIでは followers_count（現在値のみ）を同期時にスナップショット保存", api: { name: "followers_count", note: "過去時点の値は取得不可。同期した時点の値のみ" } },
  { key: "follower_net", label: "フォロワー純増", unit: "count", definition: "期間中のフォロー数 − フォロー解除数。投稿の効果と断定しない", api: { name: "follows_and_unfollows", note: "フォロワー100人未満では返らない" } },
  { key: "reach", label: "リーチ（アカウント全体・ユニーク）", unit: "count", definition: "期間中に何らかのコンテンツを見たユニークアカウント数。投稿ごとのリーチの合計とは異なる", api: { name: "reach", note: "period=day, metric_type=total_value" } },
  { key: "reach_non_follower", label: "非フォロワーへのリーチ", unit: "count", definition: "アカウント全体リーチのうち非フォロワー", api: { name: "reach (breakdown=follow_type)" } },
  { key: "views", label: "閲覧数", unit: "count", definition: "期間中のコンテンツ閲覧回数", api: { name: "views", note: "in development 表記" } },
  { key: "accounts_engaged", label: "反応したアカウント", unit: "count", definition: "期間中にコンテンツへ反応したユニークアカウント数", api: { name: "accounts_engaged" } },
  { key: "saves", label: "保存", unit: "count", definition: "期間中の保存数", api: { name: "saves" } },
  { key: "shares", label: "シェア", unit: "count", definition: "期間中のシェア数", api: { name: "shares" } },
  { key: "comments", label: "コメント", unit: "count", definition: "期間中のコメント数", api: { name: "comments", note: "in development 表記" } },
  { key: "profile_visits", label: "プロフィール訪問", unit: "count", definition: "期間中のプロフィール訪問数", api: null, apiUnavailableReason: "アカウント単位のプロフィール訪問はv25.0のユーザーインサイト一覧に無い。アプリから手入力" },
  { key: "link_taps", label: "リンクタップ", unit: "count", definition: "プロフィール上のリンク・ボタンのタップ数", api: { name: "profile_links_taps" } },
  { key: "line_signups", label: "LINE登録", unit: "count", definition: "期間中のLINE友だち追加数（LINE公式アカウント管理画面の値）", api: null, apiUnavailableReason: "Instagram API の範囲外。LINE管理画面の値を手入力/CSV" },
  { key: "site_sessions", label: "サイト訪問（Instagram経由）", unit: "count", definition: "UTMや参照元でInstagram経由と判定できたサイト訪問", api: null, apiUnavailableReason: "Instagram API の範囲外。アクセス解析の値を手入力/CSV" },
];

export const PERIOD_METRIC_KEYS = ACCOUNT_METRICS.map((m) => m.key);

export function metricDef(key: string) {
  return [...ACCOUNT_METRICS, ...POST_METRICS].find((m) => m.key === key);
}

export const DEFAULT_ROLES = {
  personal: [
    "新見康樹の人柄、挑戦、価値観を伝える",
    "応援者や協業先との関係をつくる",
    "各事業（にいみ農園・にいみ塾・IPPO・BUZZ BASE）への関心を生む",
  ],
  farm: [
    "お米の品質、生産背景、農園の日常を伝える",
    "購入・リピート・農業体験につなげる",
    "栃木や下野市との接点を増やす",
  ],
};

export const DEFAULT_TARGETS = {
  personal: [
    { name: "挑戦する若者", needs: "一歩を踏み出すきっかけ、身近なロールモデル", value_prop: "家業・教育・コミュニティを並行して挑戦する等身大の過程", themes: "挑戦の裏側、失敗と学び、イベント運営", desired_action: "フォロー、イベント参加、DM相談", monetization: "BUZZ BASE・IPPOS参加、IPPOへの送客", priority: 1, validation_method: "イベント申込時のアンケートで「Instagramを見て」の比率を記録" },
    { name: "栃木の経営者・地域のキーパーソン", needs: "信頼できる若手の協業相手、地域を動かす企画", value_prop: "農業×教育×地域の実行力と継続性", themes: "地域連携の実績、事業の考え方", desired_action: "DM・面談・紹介", monetization: "協業、法人向け農業体験、米の法人購入", priority: 2, validation_method: "協業相談の流入経路を問い合わせ時に記録" },
    { name: "農業・教育・地域活動の協業候補", needs: "一緒に企画できる相手", value_prop: "現場（田んぼ・塾・イベント）を持っていること", themes: "企画の募集、コラボ事例", desired_action: "コラボ相談", monetization: "共同企画・共催イベント", priority: 3, validation_method: "コラボ投稿後の相談件数を記録" },
  ],
  farm: [
    { name: "米を日常的に購入する家庭", needs: "おいしく、安心して、続けやすい価格で買える米", value_prop: "生産者の顔が見える直販米、炊き方・保存の知恵", themes: "米の選び方、炊き方、収穫から食卓まで", desired_action: "購入、リピート、LINE登録", monetization: "直販売上・定期購入", priority: 1, validation_method: "購入時アンケートで認知経路と購入理由を記録" },
    { name: "生産者から直接買いたい人", needs: "作り手の考えや作り方を知った上で買いたい", value_prop: "父と子で続ける米づくりの背景", themes: "米づくりの裏側、父との農作業、家業を継ぐ挑戦", desired_action: "保存、プロフィール訪問、購入", monetization: "直販", priority: 2, validation_method: "保存率・プロフィール訪問率と購入の自己申告を確認" },
    { name: "栃木や下野市に関心がある人", needs: "地元の顔が見える食材、ふるさととのつながり", value_prop: "下野市の田んぼの風景と地域連携", themes: "地域の風景、地域連携の試行錯誤", desired_action: "フォロー、シェア、ギフト購入", monetization: "直販・ギフト", priority: 3, validation_method: "オーディエンス集計（地域）と購入者の住所を集計" },
    { name: "農業体験を探す家庭・団体", needs: "子どもや社員が安全に体験できる場", value_prop: "田植え・稲刈りなどの体験と教育的な場づくり", themes: "農業体験の様子、参加者の声", desired_action: "体験申込・問い合わせ", monetization: "体験参加費・団体受入", priority: 2, validation_method: "申込フォームで認知経路を必須項目化" },
    { name: "飲食店など継続購入候補", needs: "品質の安定、継続供給、取引のしやすさ", value_prop: "品種・保管・精米の説明と相談しやすさ", themes: "品質管理、取引の流れ、店舗での活用例", desired_action: "業務用の問い合わせ", monetization: "継続取引", priority: 4, validation_method: "業務用問い合わせ数と商談化率を記録" },
  ],
};
