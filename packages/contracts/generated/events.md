<!-- Generated from packages/contracts/src/events.ts by `pnpm --filter @speeedy/contracts generate`. Do not edit by hand. -->

# Speeedy analytics events

Every event Speeedy can send. Each carries a random Visit ID that is held in memory only and changes on reload, and never a person profile, an IP address or any document text. Properties are fixed choices, bounded numbers or yes/no values. The one exception is the free text a reader types into the survey form.

## `$pageview`

A page or screen was opened. Carries the route pattern only: no query, no hash, no title.

Sent by: the app. Schema version 1.

| Property | Value | Required |
| --- | --- | --- |
| `route` | one of `/`, `/reader`, `/library`, `/stats`, `/training`, `/s`, `/account/[page]`, `/reading-speed-test`, `/pdf-speed-reader`, `/epub-speed-reader`, `/adhd-reading-tool`, `/text-to-speech-reader`, `/spreeder-alternative`, `/learn`, `/learn/[slug]`, `/share-link`, `/support`, `/plus`, `/privacy`, `/privacy/events`, `/terms`, `/changelog`, `other` | yes |
| `exp_pipeline_check` | one of `off`, `on` | no |

## `feature_survey_answered`

One answer sheet of the feature survey: a yes or no per idea, what the reader reads, and an optional own idea in free text.

Sent by: the app. Schema version 1.

| Property | Value | Required |
| --- | --- | --- |
| `idea_listen_voices` | yes or no | no |
| `idea_sync` | yes or no | no |
| `idea_browser_button` | yes or no | no |
| `idea_speed_training` | yes or no | no |
| `idea_comprehension_check` | yes or no | no |
| `idea_photo_to_text` | yes or no | no |
| `idea_read_later` | yes or no | no |
| `idea_focus_settings` | yes or no | no |
| `idea_classroom` | yes or no | no |
| `idea_bilingual` | yes or no | no |
| `idea_ai_help` | yes or no | no |
| `own_idea` | free text, up to 500 characters (the survey form only) | no |
| `reads` | one of `articles`, `books`, `papers`, `documents`, `fiction`, `news`, `other` | no |
| `exp_pipeline_check` | one of `off`, `on` | no |

## `daily_goal_met`

A reader's reading for the day reached their Daily Goal. Carries the goal and the Streak as buckets only, never exact numbers, a date or any text.

Sent by: the app. Schema version 1.

| Property | Value | Required |
| --- | --- | --- |
| `goal_minutes` | one of `1-5`, `6-10`, `11-20`, `21-30`, `31-60`, `61-plus` | yes |
| `streak_days` | one of `1`, `2-3`, `4-7`, `8-14`, `15-30`, `31-plus` | yes |
| `exp_pipeline_check` | one of `off`, `on` | no |

## `checkout_started`

The Worker opened a hosted checkout for the Plus plan. Carries the billing interval only.

Sent by: the server. Schema version 1.

| Property | Value | Required |
| --- | --- | --- |
| `interval` | one of `monthly`, `annual` | yes |

## `newsletter_signup`

A reader asked to join the newsletter and the signup was passed on for confirmation. Carries the topic and the page of the form only, never the address.

Sent by: the server. Schema version 1.

| Property | Value | Required |
| --- | --- | --- |
| `topic` | one of `speeedy`, `speeedy_building` | yes |
| `page` | one of `home`, `library`, `stats`, `account`, `support`, `about`, `changelog`, `other` | yes |

## `$exception`

An error report. It carries an error code and stack frames and nothing else: no error message, no variables, no source lines. A frame is one of the app's own bundle paths, a line, a column and a function name; code from anywhere else is a fixed `external` frame. It does not go through the registry above; it has its own fixed shape, and the server turns it into PostHog's `$exception` with an empty message, the code as the fingerprint and a fixed description per code.

Sent by: the app. Schema version 1. At most 5 per Visit.

| Property | Value | Required |
| --- | --- | --- |
| `code` | one of `unhandled_error`, `unhandled_rejection`, `render_error`, `parser_error`, `storage_error`, `audio_error` | yes |
| `frames` | up to 20 stack frames, each one of the app's own bundle paths (no origin, query or hash) or the fixed marker `external`, a line, a column and a function name that is plain identifiers joined by dots (or `?`) | yes |
