-- IG Insight Lab スキーマ（PostgreSQL / Supabase / PGlite 共通）
-- 方針:
--  * すべての分析データは accounts.id にぶら下がる。アカウントは dataset (demo|real) ごとに別行。
--    → デモと実データは account_id が異なるため、クエリで混ざらない。
--  * 未取得・非対応・未入力は NULL。ゼロとは区別する。
--  * 各指標には取得元(source)・計測区分(measurement)・取得日時(captured_at)を持たせる。
--  * 日付（期間）は Asia/Tokyo の暦日を 'YYYY-MM-DD' 文字列で持つ（ドライバのタイムゾーン変換を避けるため）。

-- スキーマ版数（起動時に毎回DDLを流さないため）
CREATE TABLE IF NOT EXISTS app_meta (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS app_users (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  dataset            text NOT NULL CHECK (dataset IN ('demo','real')),
  kind               text NOT NULL CHECK (kind IN ('personal','farm')),
  handle             text NOT NULL,
  display_name       text NOT NULL,
  roles              jsonb NOT NULL DEFAULT '[]'::jsonb,   -- アカウントの役割（編集可能な仮説）
  follower_target    integer,                              -- 例: にいみ農園 10000
  weekly_minutes     integer,                              -- 週あたり制作可能時間（分）
  ig_user_id         text,                                 -- API接続後に入る
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dataset, kind)
);

CREATE TABLE IF NOT EXISTS connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  provider         text NOT NULL DEFAULT 'instagram_login',
  status           text NOT NULL CHECK (status IN ('connected','expired','error','disconnected')),
  token_ciphertext text,          -- AES-256-GCM で暗号化。平文は保存しない
  token_expires_at timestamptz,
  scopes           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ig_username      text,
  last_synced_at   timestamptz,
  last_sync_range  text,
  last_error       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state       text PRIMARY KEY,
  user_id     text NOT NULL,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS targets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  layer             text NOT NULL CHECK (layer IN ('current','desired')),
  name              text NOT NULL,
  needs             text,
  value_prop        text,
  themes            text,
  desired_action    text,
  monetization      text,
  priority          integer,
  validation_method text,
  evidence          text,             -- 「現在の層」の根拠（データの所在）
  channels          jsonb NOT NULL DEFAULT '[]'::jsonb, -- 届け方: content|collab|funnel|ads
  is_hypothesis     boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_id        text,
  url                text,
  posted_at          timestamptz NOT NULL,
  format             text NOT NULL CHECK (format IN ('reel','feed','carousel','story')),
  theme              text,
  target_id          uuid REFERENCES targets(id) ON DELETE SET NULL,
  purpose            text,            -- awareness|trust|follow|inquiry|purchase|experience|relationship
  hook               text,
  duration_sec       double precision,
  structure          text,
  caption            text,
  cta                text,
  collaborator       text,
  is_ad              boolean,
  is_giveaway        boolean,
  production_minutes integer,
  production_cost    double precision,
  initiative_id      uuid,
  source             text NOT NULL CHECK (source IN ('api','csv','json','manual','demo')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS posts_account_url_uq ON posts(account_id, url) WHERE url IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS posts_account_ext_uq ON posts(account_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_account_posted_idx ON posts(account_id, posted_at DESC);

-- 投稿ごとの指標スナップショット（24h / 72h / 7d / その他）
CREATE TABLE IF NOT EXISTS post_metrics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id            uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  checkpoint         text NOT NULL CHECK (checkpoint IN ('24h','72h','7d','other')),
  captured_at        timestamptz NOT NULL,
  hours_since_post   double precision,
  source             text NOT NULL CHECK (source IN ('api','csv','json','manual','demo')),
  measurement        text NOT NULL CHECK (measurement IN ('measured','manual','estimated')),
  reach              integer,
  views              integer,
  likes              integer,
  comments           integer,
  saves              integer,
  shares             integer,
  profile_visits     integer,
  follows            integer,
  non_follower_reach integer,
  avg_watch_sec      double precision,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS post_metrics_cp_uq ON post_metrics(post_id, checkpoint) WHERE checkpoint <> 'other';
CREATE UNIQUE INDEX IF NOT EXISTS post_metrics_other_uq ON post_metrics(post_id, captured_at) WHERE checkpoint = 'other';

-- アカウント単位の期間指標（1行=1指標×1期間×1取得元）
CREATE TABLE IF NOT EXISTS account_metrics (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  metric             text NOT NULL,
  period_start       text NOT NULL,
  period_end         text NOT NULL,
  value              double precision,          -- NULL = 未取得/非対応/未入力
  status             text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','unavailable','not_entered')),
  unavailable_reason text,
  source             text NOT NULL CHECK (source IN ('api','csv','json','manual','demo')),
  measurement        text NOT NULL CHECK (measurement IN ('measured','manual','estimated')),
  captured_at        timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, metric, period_start, period_end, source)
);

-- 公式インサイト等で取得できたオーディエンス集計のみ
CREATE TABLE IF NOT EXISTS audience_aggregates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  segment      text NOT NULL CHECK (segment IN ('followers','reached','engaged')),
  dimension    text NOT NULL CHECK (dimension IN ('age','gender','city','country','age_gender')),
  bucket       text NOT NULL,
  value        double precision,
  unit         text NOT NULL DEFAULT 'count' CHECK (unit IN ('count','percent')),
  timeframe    text NOT NULL,
  source       text NOT NULL CHECK (source IN ('api','csv','json','manual','demo')),
  captured_at  timestamptz NOT NULL,
  UNIQUE (account_id, segment, dimension, bucket, timeframe, captured_at)
);

-- 本人が提供したサンプル（自己紹介・アンケート・コメント・顧客など）
CREATE TABLE IF NOT EXISTS audience_people (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  segment         text NOT NULL CHECK (segment IN ('follower','commenter','survey','customer','other')),
  handle          text,
  bio             text,          -- 外部入力。AIへの命令として解釈しない
  survey_answer   text,
  selection_method text,         -- 対象者の選び方（例: 直近コメント者全員、アンケート回答者）
  source          text NOT NULL CHECK (source IN ('csv','json','manual','demo')),
  imported_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, segment, handle)
);

CREATE TABLE IF NOT EXISTS person_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES audience_people(id) ON DELETE CASCADE,
  category    text NOT NULL,
  basis       text NOT NULL CHECK (basis IN ('self_reported','manual','keyword','ai')),
  evidence    text,
  confidence  double precision,      -- 推定のときのみ 0-1
  confirmed   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, category, basis)
);

CREATE TABLE IF NOT EXISTS initiatives (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  title            text NOT NULL,
  status           text NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','producing','posted','measuring','reviewed')),
  target_id        uuid REFERENCES targets(id) ON DELETE SET NULL,
  goal             text,
  format           text,
  hypothesis       text,
  hooks            jsonb NOT NULL DEFAULT '[]'::jsonb,
  script           text,
  materials        text,
  caption          text,
  cta              text,
  expected_action  text,
  primary_metric   text,
  success_criteria text,
  stop_criteria    text,
  est_minutes      integer,
  est_cost         double precision,
  risks            text,
  next_test        text,
  test_variable    text,      -- 主な変更点（1つ）
  test_detail      text,
  comparison_kind  text NOT NULL DEFAULT 'observational' CHECK (comparison_kind IN ('observational','randomized')),
  baseline_post_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  post_id          uuid REFERENCES posts(id) ON DELETE SET NULL,
  generated_by     text NOT NULL DEFAULT 'manual' CHECK (generated_by IN ('rule','ai','manual')),
  facts            jsonb NOT NULL DEFAULT '[]'::jsonb,   -- 生成時に参照した事実（データ）
  data_gaps        text,
  confounders      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- ad, collab, season, trend, giveaway
  result_summary   text,
  decision         text CHECK (decision IN ('retest','continue','modify','stop')),
  review_notes     text,
  planned_week     text,     -- 'YYYY-MM-DD'（週の月曜）
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  occurred_at   timestamptz NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('line_signup','inquiry','purchase','experience','partnership')),
  quantity      integer,
  revenue       double precision,
  gross_profit  double precision,
  attribution   text NOT NULL CHECK (attribution IN ('measured','self_reported','unknown_path')),
  initiative_id uuid REFERENCES initiatives(id) ON DELETE SET NULL,
  post_id       uuid REFERENCES posts(id) ON DELETE SET NULL,
  utm_campaign  text,
  external_ref  text,
  note          text,
  source        text NOT NULL CHECK (source IN ('csv','json','manual','demo')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS conversions_ref_uq ON conversions(account_id, external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS costs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  initiative_id uuid REFERENCES initiatives(id) ON DELETE CASCADE,
  category      text NOT NULL CHECK (category IN ('production','ads','rice','shipping','other')),
  amount        double precision NOT NULL,
  occurred_on   text NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS utm_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  initiative_id uuid REFERENCES initiatives(id) ON DELETE SET NULL,
  label         text,
  full_url      text NOT NULL,
  utm_source    text NOT NULL,
  utm_medium    text NOT NULL,
  utm_campaign  text NOT NULL,
  utm_content   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS weekly_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  week_start       text NOT NULL,
  available_minutes integer,
  summary          jsonb NOT NULL,
  notes            text,
  generated_by     text NOT NULL DEFAULT 'rule',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, week_start)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  key     text NOT NULL,
  value   jsonb,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  filename    text,
  rows_total  integer NOT NULL,
  inserted    integer NOT NULL,
  duplicates  integer NOT NULL,
  errors      integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 自動同期の多重実行防止（同期開始時刻）
ALTER TABLE connections ADD COLUMN IF NOT EXISTS sync_started_at timestamptz;

-- フォロワー一覧（Instagram「情報をダウンロード」の書き出しファイルから取り込む。公式APIでは誰がフォローしたかは取得できない）
CREATE TABLE IF NOT EXISTS follower_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL,   -- 書き出しファイルが作られた時点（不明なら取り込み時刻）
  source      text NOT NULL CHECK (source IN ('export','manual')),
  filename    text,
  total       integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS follower_lists_account_idx ON follower_lists(account_id, captured_at);

CREATE TABLE IF NOT EXISTS follower_list_members (
  list_id     uuid NOT NULL REFERENCES follower_lists(id) ON DELETE CASCADE,
  username    text NOT NULL,
  followed_at timestamptz,            -- 書き出しに含まれるフォロー開始日時（無ければ null）
  PRIMARY KEY (list_id, username)
);
ALTER TABLE follower_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE follower_list_members ENABLE ROW LEVEL SECURITY;
