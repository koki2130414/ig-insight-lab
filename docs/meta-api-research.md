# Meta公式ドキュメント確認記録

- 確認日: 2026-10-11（JST）
- 採用APIバージョン: **Graph API v25.0**（ドキュメント上の最新版。`META_GRAPH_VERSION` で変更可能）
- 採用構成: **Instagram API with Instagram Login**（`graph.instagram.com`）
  - Facebookページとの連携が不要で、プロアカウント単体で接続できるため

## 確認したURL

| 内容 | URL |
|---|---|
| 概要（構成・権限・アクセスレベル・トークン） | https://developers.facebook.com/docs/instagram-platform/overview |
| Business Login for Instagram（OAuth手順） | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login.md |
| Instagram Login 版の概要 | https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login.md |
| インサイト共通の要件・制限 | https://developers.facebook.com/documentation/instagram-platform/insights.md |
| 投稿（メディア）インサイト | https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights |
| アカウント（ユーザー）インサイト | https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights |
| IG User（followers_count など） | https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user.md |
| IG User Media | https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media |
| App Review | https://developers.facebook.com/documentation/instagram-platform/app-review.md |
| 変更履歴 | https://developers.facebook.com/documentation/instagram-platform/changelog.md （最新エントリ 2026-06-22） |

## 確認できたこと

### 対象アカウント
- **プロアカウント（ビジネス／クリエイター）のみ**。個人アカウントはAPI対象外。
  - `@_ko_213` が個人アカウントの場合はAPI接続不可。手入力・CSVで運用する。

### 認証・権限
- 認可URL: `https://www.instagram.com/oauth/authorize`（`client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`）
- 短期トークン: `POST https://api.instagram.com/oauth/access_token`（認可コードは1時間・1回限り）
- 長期トークン: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`（60日）
- 更新: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`（発行24時間後〜期限内）
- インサイトに必要な権限: **`instagram_business_basic` と `instagram_business_manage_insights`**
- 旧スコープ名 `business_basic` 等は 2025-01-27 に廃止済み。

### 審査の要否
- 自分が所有・管理し、アプリダッシュボードに追加したアカウントのみを扱う場合は **Standard Access で利用可能、App Review 不要**。
- 他人のアカウントを扱う場合は Advanced Access（App Review とビジネス認証が必要）。このアプリは対象外。

### 取得できる指標（このアプリで使うもの）
投稿単位（`/{media-id}/insights`）:
- reach / views / shares（リール・フィード・ストーリーズ）
- likes / comments / saved（リール・フィード）
- profile_visits / follows（フィード・ストーリーズ。**リールは非対応**）
- ig_reels_avg_watch_time（リール・ミリ秒）
- `impressions`, `plays`, `clips_replays_count`, `ig_reels_aggregated_all_plays_count` は廃止 → 使わない

アカウント単位（`/me/insights`, `period=day`, `metric_type=total_value`, `since`/`until`）:
- reach（`breakdown=follow_type` で FOLLOWER / NON_FOLLOWER）, views, accounts_engaged, saves, shares, comments, profile_links_taps, follows_and_unfollows
- follower_demographics / engaged_audience_demographics（`period=lifetime`, `timeframe=this_week|this_month`, breakdown age/city/country/gender）
- フォロワー数は IG User の `followers_count` フィールド（現在値のみ）

### 制限
- データの反映に最大48時間の遅延。
- 利用できないデータは **空の結果（0ではない）** で返る → アプリでは null として保存。
- ストーリーズの指標は24時間のみ。Instagram Login 構成では insights の Webhook 非対応。
- フォロワー100人未満では follower_count / follows_and_unfollows / follower_demographics が返らない。
- engaged_audience_demographics は期間内の反応100件未満では返らない。属性は上位45件のみ。
- メディア指標の保存期間は最大2年、ユーザー指標は最大90日。
- 投稿後24時間・72時間・7日時点の値を後から取得するAPIは無い → 同期時点のスナップショット（各時点±25%）か手入力で記録。

## 確認できなかったこと（実装で仮定していない／要確認）
- **レート制限の具体的な数値**: 公式のレート制限ページを取得できなかった（ログイン要求・404）。
  数値は実装せず、HTTP 429・エラーコード 4/17/32/613 を受けたら指数バックオフで最大3回再試行するだけにしている。
- `follows_and_unfollows` の `follow_type` 内訳（FOLLOWER=フォロー、NON_FOLLOWER=フォロー解除と解釈）は、実アカウント接続時に値を確認すること。
- `reached_audience_demographics` はユーザーインサイトの一覧に記載が無かったため実装していない（到達者の属性はCSV取り込みのみ）。
- アカウント単位の `profile_visits` は v25.0 のユーザーインサイト一覧に無いため手入力。

## 実装上のルール
- アカウント名だけで非公開インサイトを取得する機能は作らない（OAuthで本人が接続したアカウントのみ）。
- OAuth後、ログインしたユーザー名が接続先のハンドルと一致しない場合は保存しない。
- トークンは AES-256-GCM で暗号化してDBに保存。ブラウザ・ログ・エクスポートには出さない。
- スクレイピング・パスワード保存・非公式APIは使わない。投稿・DM・フォロー・いいね・広告配信は行わない。
