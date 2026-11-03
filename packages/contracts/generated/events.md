<!-- Generated from packages/contracts/src/events.ts by `pnpm --filter @speeedy/contracts generate`. Do not edit by hand. -->

# Speeedy analytics events

Every event Speeedy can send. Each carries a random Visit ID that is held in memory only and changes on reload, and never a person profile, an IP address or any document text. Properties are fixed choices, bounded numbers or yes/no values. The one exception is the free text a reader types into the survey form.

## `$pageview`

A page or screen was opened. Carries the route pattern only: no query, no hash, no title.

Sent by: the app. Schema version 1.

| Property | Value | Required |
| --- | --- | --- |
| `route` | one of `/`, `/reader`, `/library`, `/stats`, `/training`, `/s`, `/account`, `/account/[page]`, `/reading-speed-test`, `/pdf-speed-reader`, `/epub-speed-reader`, `/adhd-reading-tool`, `/text-to-speech-reader`, `/spreeder-alternative`, `/learn`, `/learn/[slug]`, `/share-link`, `/support`, `/plus`, `/privacy`, `/terms`, `/changelog`, `other` | yes |

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

## `checkout_started`

The Worker opened a hosted checkout for the Plus plan. Carries the billing interval only.

Sent by: the server. Schema version 1.

| Property | Value | Required |
| --- | --- | --- |
| `interval` | one of `monthly`, `annual` | yes |
