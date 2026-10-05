# 当前数据库结构清单

来源：将当前工作区 SCHEMAS 应用到全新、内存中的 PGlite，再读取系统目录。这里不是线上数据库的实时结构，也不代表线上实际执行计划。

得到 31 张业务/统计表，73 个索引（包含主键、唯一约束隐含索引）；另有启动迁移创建的 schema_marks 表。

各表的列、索引及键约束如下；机器可读版本见 [schema.json](schema.json)。

## card_accounts

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id_hash` | text | NO |
| `created` | timestamp with time zone | NO |
| `seen` | timestamp with time zone | NO |
| `name` | text | YES |
| `rev` | integer | NO |
| `state` | jsonb | NO |
| `saved` | timestamp with time zone | YES |
| `ladder_seen` | integer | YES |
| `ladder_at` | timestamp with time zone | YES |
| `suspect` | boolean | NO |
| `pardon_seen` | integer | YES |
| `pardon_at` | timestamp with time zone | YES |
| `verified` | timestamp with time zone | YES |
| `verify_via` | text | YES |

```sql
CREATE UNIQUE INDEX card_accounts_pkey ON public.card_accounts USING btree (id_hash);
CREATE INDEX card_code_idx ON public.card_accounts USING btree ("left"(id_hash, 8));
CREATE INDEX card_seen_idx ON public.card_accounts USING btree (seen DESC);
-- PRIMARY KEY (id_hash)
```

## card_gifts

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | bigint | NO |
| `from_h` | text | NO |
| `to_h` | text | NO |
| `card_id` | text | NO |
| `note` | text | YES |
| `sent` | timestamp with time zone | NO |
| `claimed` | timestamp with time zone | YES |

```sql
CREATE UNIQUE INDEX card_gifts_pkey ON public.card_gifts USING btree (id);
CREATE INDEX gift_to_idx ON public.card_gifts USING btree (to_h) WHERE (claimed IS NULL);
-- PRIMARY KEY (id)
```

## card_listings

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | bigint | NO |
| `seller_h` | text | NO |
| `card_id` | text | NO |
| `level` | integer | NO |
| `ask` | integer | NO |
| `status` | text | NO |
| `created` | timestamp with time zone | NO |
| `closed` | timestamp with time zone | YES |
| `ignored` | integer | NO |
| `ends` | timestamp with time zone | YES |
| `buyout` | integer | YES |
| `hours` | integer | NO |
| `cur_price` | integer | YES |
| `top_bid` | integer | YES |
| `top_buyer_h` | text | YES |
| `open_n` | integer | YES |
| `bid_n` | integer | YES |
| `draw_at` | timestamp with time zone | YES |

```sql
CREATE UNIQUE INDEX card_listings_pkey ON public.card_listings USING btree (id);
CREATE INDEX listing_draw_idx ON public.card_listings USING btree (draw_at) WHERE ((status = 'open'::text) AND (draw_at IS NOT NULL));
CREATE INDEX listing_ends_idx ON public.card_listings USING btree (ends) WHERE (status = 'open'::text);
CREATE INDEX listing_open_idx ON public.card_listings USING btree (created DESC) WHERE (status = 'open'::text);
CREATE INDEX listing_seller_idx ON public.card_listings USING btree (seller_h);
CREATE INDEX listing_shelf_card_idx ON public.card_listings USING btree (card_id) WHERE (status = 'open'::text);
CREATE INDEX listing_shelf_ends_idx ON public.card_listings USING btree (ends, id) WHERE (status = 'open'::text);
CREATE INDEX listing_shelf_new_idx ON public.card_listings USING btree (created DESC, id) WHERE (status = 'open'::text);
CREATE INDEX listing_shelf_price_idx ON public.card_listings USING btree (cur_price, id) WHERE (status = 'open'::text);
CREATE INDEX listing_sold_card_idx ON public.card_listings USING btree (card_id, closed DESC) WHERE (status = 'sold'::text);
-- PRIMARY KEY (id)
```

## card_mail

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | bigint | NO |
| `to_h` | text | NO |
| `kind` | text | NO |
| `card_id` | text | YES |
| `level` | integer | NO |
| `coins` | integer | NO |
| `pack` | text | YES |
| `count` | integer | NO |
| `body` | jsonb | YES |
| `made` | timestamp with time zone | NO |
| `taken` | timestamp with time zone | YES |

```sql
CREATE UNIQUE INDEX card_mail_pkey ON public.card_mail USING btree (id);
CREATE INDEX mail_to_idx ON public.card_mail USING btree (to_h) WHERE (taken IS NULL);
-- PRIMARY KEY (id)
```

## card_offers

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | bigint | NO |
| `listing` | bigint | NO |
| `buyer_h` | text | NO |
| `price` | integer | NO |
| `status` | text | NO |
| `made` | timestamp with time zone | NO |
| `settled` | timestamp with time zone | YES |

```sql
CREATE UNIQUE INDEX card_offers_pkey ON public.card_offers USING btree (id);
CREATE INDEX offer_accepted_buyer_idx ON public.card_offers USING btree (buyer_h) WHERE (status = 'accepted'::text);
CREATE INDEX offer_buyer_idx ON public.card_offers USING btree (buyer_h);
CREATE INDEX offer_listing_idx ON public.card_offers USING btree (listing);
CREATE INDEX offer_open_idx ON public.card_offers USING btree (listing) WHERE (status = 'open'::text);
-- PRIMARY KEY (id)
-- FOREIGN KEY (listing) REFERENCES card_listings(id)
```

## card_phones

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `phone_h` | text | NO |
| `id_hash` | text | NO |
| `id_enc` | text | NO |
| `last4` | text | NO |
| `bound` | timestamp with time zone | NO |

```sql
CREATE UNIQUE INDEX card_phones_id_hash_key ON public.card_phones USING btree (id_hash);
CREATE UNIQUE INDEX card_phones_pkey ON public.card_phones USING btree (phone_h);
-- PRIMARY KEY (phone_h)
-- UNIQUE (id_hash)
```

## card_requests

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id_hash` | text | NO |
| `request_id` | text | NO |
| `action` | text | NO |
| `reply` | jsonb | YES |
| `at` | timestamp with time zone | NO |

```sql
CREATE INDEX card_requests_at_idx ON public.card_requests USING btree (at);
CREATE UNIQUE INDEX card_requests_pkey ON public.card_requests USING btree (id_hash, request_id);
-- PRIMARY KEY (id_hash, request_id)
```

## card_sms

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `phone_h` | text | NO |
| `code_h` | text | NO |
| `sent` | timestamp with time zone | NO |
| `tries` | integer | NO |
| `ip` | text | YES |

```sql
CREATE INDEX card_sms_phone_idx ON public.card_sms USING btree (phone_h, sent DESC);
```

## card_swaps

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | bigint | NO |
| `from_h` | text | NO |
| `to_h` | text | NO |
| `give_id` | text | NO |
| `give_level` | integer | NO |
| `want_id` | text | NO |
| `status` | text | NO |
| `made` | timestamp with time zone | NO |
| `settled` | timestamp with time zone | YES |

```sql
CREATE UNIQUE INDEX card_swaps_pkey ON public.card_swaps USING btree (id);
CREATE INDEX swap_from_idx ON public.card_swaps USING btree (from_h) WHERE (status = 'open'::text);
CREATE INDEX swap_to_idx ON public.card_swaps USING btree (to_h) WHERE (status = 'open'::text);
-- PRIMARY KEY (id)
```

## champion_message_reviews

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | text | NO |
| `message_id` | text | NO |
| `before_status` | text | NO |
| `after_status` | text | NO |
| `reason` | text | NO |
| `created` | timestamp with time zone | NO |

```sql
CREATE UNIQUE INDEX champion_message_reviews_pkey ON public.champion_message_reviews USING btree (id);
-- PRIMARY KEY (id)
```

## champion_messages

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | text | NO |
| `event` | text | NO |
| `account_hash` | text | NO |
| `request_key` | text | NO |
| `author` | text | NO |
| `target` | text | NO |
| `body` | text | NO |
| `status` | text | NO |
| `created` | timestamp with time zone | NO |
| `reviewed` | timestamp with time zone | YES |
| `reason` | text | NO |

```sql
CREATE UNIQUE INDEX champion_messages_account_hash_request_key_key ON public.champion_messages USING btree (account_hash, request_key);
CREATE INDEX champion_messages_account_idx ON public.champion_messages USING btree (account_hash, created DESC);
CREATE UNIQUE INDEX champion_messages_pkey ON public.champion_messages USING btree (id);
CREATE INDEX champion_messages_public_idx ON public.champion_messages USING btree (event, status, created DESC);
-- CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
-- UNIQUE (account_hash, request_key)
-- PRIMARY KEY (id)
```

## daily_stats

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `day` | date | NO |
| `visitors` | integer | NO |
| `new_visitors` | integer | NO |
| `sessions` | integer | NO |
| `active_min` | integer | NO |
| `career_starts` | integer | NO |
| `turns` | integer | NO |
| `card_starts` | integer | NO |
| `card_pulls` | integer | NO |
| `card_matches` | integer | NO |
| `errors` | integer | NO |
| `events` | integer | NO |
| `built` | timestamp with time zone | NO |

```sql
CREATE UNIQUE INDEX daily_stats_pkey ON public.daily_stats USING btree (day);
-- PRIMARY KEY (day)
```

## enc_entries

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id_hash` | text | NO |
| `name` | text | YES |
| `nat` | text | NO |
| `five` | jsonb | NO |
| `score` | integer | NO |
| `updated` | timestamp with time zone | NO |

```sql
CREATE UNIQUE INDEX enc_entries_pkey ON public.enc_entries USING btree (id_hash);
CREATE INDEX enc_entries_updated_idx ON public.enc_entries USING btree (updated DESC);
-- PRIMARY KEY (id_hash)
```

## events

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | bigint | NO |
| `ts` | timestamp with time zone | NO |
| `client_t` | bigint | YES |
| `visitor_id` | text | NO |
| `session_id` | text | NO |
| `seq` | integer | YES |
| `device` | text | YES |
| `tz` | integer | YES |
| `name` | text | NO |
| `props` | jsonb | YES |
| `n` | integer | YES |

```sql
CREATE UNIQUE INDEX events_dedupe_idx ON public.events USING btree (session_id, n) WHERE (n IS NOT NULL);
CREATE INDEX events_name_idx ON public.events USING btree (name, ts DESC);
CREATE UNIQUE INDEX events_pkey ON public.events USING btree (id);
CREATE INDEX events_ts_idx ON public.events USING btree (ts DESC);
CREATE INDEX events_visitor_idx ON public.events USING btree (visitor_id, ts);
-- PRIMARY KEY (id)
```

## market_bans

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | bigint | NO |
| `id_hash` | text | NO |
| `until` | timestamp with time zone | NO |
| `rule` | text | NO |
| `evidence` | jsonb | NO |
| `by` | text | NO |
| `made` | timestamp with time zone | NO |
| `lifted` | timestamp with time zone | YES |

```sql
CREATE UNIQUE INDEX market_bans_pkey ON public.market_bans USING btree (id);
CREATE INDEX market_bans_who_idx ON public.market_bans USING btree (id_hash, made DESC);
-- PRIMARY KEY (id)
```

## open_cup_engine_builds

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `hash` | text | NO |
| `compressed` | text | NO |
| `created` | timestamp with time zone | NO |

```sql
CREATE UNIQUE INDEX open_cup_engine_builds_pkey ON public.open_cup_engine_builds USING btree (hash);
-- PRIMARY KEY (hash)
```

## open_cup_entries

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `cup_id` | bigint | NO |
| `id_hash` | text | NO |
| `name` | text | YES |
| `five` | jsonb | YES |
| `score` | integer | YES |
| `alive` | boolean | NO |
| `wins` | integer | NO |
| `byes` | integer | NO |
| `out_round` | integer | YES |
| `place` | integer | YES |
| `joined` | timestamp with time zone | NO |
| `swiss_wins` | integer | NO |
| `swiss_losses` | integer | NO |
| `swiss_real_wins` | integer | NO |
| `playoff_wins` | integer | NO |
| `floats` | integer | NO |
| `map_diff` | integer | NO |
| `met` | jsonb | NO |
| `playoff_seed` | integer | YES |
| `pick` | jsonb | YES |

```sql
CREATE UNIQUE INDEX open_cup_entries_pkey ON public.open_cup_entries USING btree (cup_id, id_hash);
CREATE INDEX open_cup_entries_who_idx ON public.open_cup_entries USING btree (id_hash, cup_id);
-- PRIMARY KEY (cup_id, id_hash)
```

## open_cup_matches

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `cup_id` | bigint | NO |
| `round` | integer | NO |
| `slot` | integer | NO |
| `a` | text | NO |
| `b` | text | YES |
| `winner` | text | YES |
| `maps_a` | integer | YES |
| `maps_b` | integer | YES |
| `detail` | jsonb | YES |
| `stage` | text | NO |
| `stage_round` | integer | NO |
| `bo` | integer | YES |
| `lease_until` | timestamp with time zone | YES |
| `lease_token` | text | YES |
| `attempts` | integer | NO |
| `error` | text | YES |

```sql
CREATE INDEX open_cup_matches_a_idx ON public.open_cup_matches USING btree (cup_id, a);
CREATE INDEX open_cup_matches_b_idx ON public.open_cup_matches USING btree (cup_id, b);
CREATE INDEX open_cup_matches_pending_idx ON public.open_cup_matches USING btree (cup_id, round, slot) WHERE (winner IS NULL);
CREATE UNIQUE INDEX open_cup_matches_pkey ON public.open_cup_matches USING btree (cup_id, round, slot);
CREATE INDEX open_cup_matches_stage_idx ON public.open_cup_matches USING btree (cup_id, stage, round, slot);
-- PRIMARY KEY (cup_id, round, slot)
```

## open_cup_payouts

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `cup_id` | bigint | NO |
| `id_hash` | text | NO |
| `created` | timestamp with time zone | NO |

```sql
CREATE UNIQUE INDEX open_cup_payouts_pkey ON public.open_cup_payouts USING btree (cup_id, id_hash);
-- PRIMARY KEY (cup_id, id_hash)
```

## open_cups

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | bigint | NO |
| `starts` | timestamp with time zone | NO |
| `status` | text | NO |
| `round` | integer | NO |
| `rounds` | integer | NO |
| `step_sec` | integer | NO |
| `seed` | bigint | NO |
| `entrants` | integer | NO |
| `champion` | text | YES |
| `finished` | timestamp with time zone | YES |
| `balance_version` | integer | NO |
| `engine_hash` | text | YES |
| `format_version` | integer | NO |
| `phase` | text | NO |
| `stage_round` | integer | NO |
| `playoff` | jsonb | YES |

```sql
CREATE INDEX open_cups_champion_idx ON public.open_cups USING btree (champion, finished) WHERE (champion IS NOT NULL);
CREATE UNIQUE INDEX open_cups_pkey ON public.open_cups USING btree (id);
CREATE UNIQUE INDEX open_cups_starts_key ON public.open_cups USING btree (starts);
CREATE INDEX open_cups_status_idx ON public.open_cups USING btree (status, starts);
-- PRIMARY KEY (id)
-- UNIQUE (starts)
```

## rollup_day_counts

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `day` | date | NO |
| `career_starts` | integer | NO |
| `old_turns` | integer | NO |
| `card_starts` | integer | NO |
| `card_pulls` | integer | NO |
| `card_matches` | integer | NO |
| `errors` | integer | NO |
| `events` | integer | NO |

```sql
CREATE UNIQUE INDEX rollup_day_counts_pkey ON public.rollup_day_counts USING btree (day);
-- PRIMARY KEY (day)
```

## rollup_day_sessions

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `day` | date | NO |
| `session_id` | text | NO |
| `secs` | integer | NO |
| `turn_total` | integer | NO |

```sql
CREATE UNIQUE INDEX rollup_day_sessions_pkey ON public.rollup_day_sessions USING btree (day, session_id);
-- PRIMARY KEY (day, session_id)
```

## rollup_day_visitors

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `day` | date | NO |
| `visitor_id` | text | NO |

```sql
CREATE UNIQUE INDEX rollup_day_visitors_pkey ON public.rollup_day_visitors USING btree (day, visitor_id);
-- PRIMARY KEY (day, visitor_id)
```

## rollup_state

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `key` | text | NO |
| `last_id` | bigint | NO |
| `bootstrap_day` | date | YES |
| `updated` | timestamp with time zone | NO |

```sql
CREATE UNIQUE INDEX rollup_state_pkey ON public.rollup_state USING btree (key);
-- PRIMARY KEY (key)
```

## site_config

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `key` | text | NO |
| `value` | jsonb | NO |
| `updated` | timestamp with time zone | NO |

```sql
CREATE UNIQUE INDEX site_config_pkey ON public.site_config USING btree (key);
-- PRIMARY KEY (key)
```

## site_profiles

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id_hash` | text | NO |
| `created` | timestamp with time zone | NO |
| `seen` | timestamp with time zone | NO |
| `profile` | jsonb | NO |

```sql
CREATE UNIQUE INDEX site_profiles_pkey ON public.site_profiles USING btree (id_hash);
-- PRIMARY KEY (id_hash)
```

## team_cup_entries

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `cup_id` | bigint | NO |
| `id_hash` | text | NO |
| `name` | text | YES |
| `joined` | timestamp with time zone | NO |
| `five` | jsonb | YES |
| `score` | integer | YES |
| `team` | integer | YES |
| `duels` | integer | NO |
| `duel_wins` | integer | NO |
| `place` | integer | YES |
| `pick` | jsonb | YES |

```sql
CREATE UNIQUE INDEX team_cup_entries_pkey ON public.team_cup_entries USING btree (cup_id, id_hash);
CREATE INDEX team_cup_entries_team_idx ON public.team_cup_entries USING btree (cup_id, team);
CREATE INDEX team_cup_entries_who_idx ON public.team_cup_entries USING btree (id_hash, cup_id DESC);
-- FOREIGN KEY (cup_id) REFERENCES team_cups(id) ON DELETE CASCADE
-- PRIMARY KEY (cup_id, id_hash)
```

## team_cup_payouts

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `cup_id` | bigint | NO |
| `id_hash` | text | NO |

```sql
CREATE UNIQUE INDEX team_cup_payouts_pkey ON public.team_cup_payouts USING btree (cup_id, id_hash);
-- FOREIGN KEY (cup_id) REFERENCES team_cups(id) ON DELETE CASCADE
-- PRIMARY KEY (cup_id, id_hash)
```

## team_cup_ties

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `cup_id` | bigint | NO |
| `round` | integer | NO |
| `slot` | integer | NO |
| `team_a` | integer | NO |
| `team_b` | integer | YES |
| `wins_a` | integer | YES |
| `wins_b` | integer | YES |
| `winner` | integer | YES |
| `duels` | jsonb | YES |

```sql
CREATE UNIQUE INDEX team_cup_ties_pkey ON public.team_cup_ties USING btree (cup_id, round, slot);
-- FOREIGN KEY (cup_id) REFERENCES team_cups(id) ON DELETE CASCADE
-- PRIMARY KEY (cup_id, round, slot)
```

## team_cups

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `id` | bigint | NO |
| `starts` | timestamp with time zone | NO |
| `status` | text | NO |
| `seed` | bigint | NO |
| `round` | integer | NO |
| `rounds` | integer | NO |
| `step_sec` | integer | NO |
| `entrants` | integer | NO |
| `teams` | integer | NO |
| `champion` | integer | YES |
| `balance_version` | integer | YES |
| `created` | timestamp with time zone | NO |
| `finished` | timestamp with time zone | YES |

```sql
CREATE UNIQUE INDEX team_cups_pkey ON public.team_cups USING btree (id);
CREATE UNIQUE INDEX team_cups_starts_key ON public.team_cups USING btree (starts);
-- PRIMARY KEY (id)
-- UNIQUE (starts)
```

## visitors

| 列 | 类型 | 可空 |
| --- | --- | --- |
| `visitor_id` | text | NO |
| `first_seen` | timestamp with time zone | NO |
| `last_seen` | timestamp with time zone | NO |
| `device` | text | YES |
| `host` | text | YES |

```sql
CREATE INDEX visitors_first_idx ON public.visitors USING btree (first_seen);
CREATE UNIQUE INDEX visitors_pkey ON public.visitors USING btree (visitor_id);
-- PRIMARY KEY (visitor_id)
```

## schema_marks

`hash text PRIMARY KEY, at timestamptz NOT NULL DEFAULT now()`；来自 db-schema.js 的 MARK_TABLE。
