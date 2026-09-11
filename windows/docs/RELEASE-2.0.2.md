# Windows 2.0.2 Preview 3

Account token rows now show approximate USD amounts beside Today, Yesterday and Last 30 Days, using official per-model API prices. The compact panel and accurate allowance bar remain, without a separate cost graph or a price in the tray.

## How estimates work

Account totals do not include the model/input/output/cache breakdown. Settings → Codex therefore offers an explicit pricing scenario: reference model, cached-input share, output share, cache-write share and long-context rates. Shares refer to all tokens; the remainder is uncached input. The initial reference is GPT-5.6 Sol with 100% uncached input at standard-context rates. This is an assumption, not a measured usage mix, and may substantially differ from actual API-equivalent cost.

Cost = total tokens / 1,000,000 × the weighted official rate. Models: Sol, Astra, Terra and Luna. Prices verified 2026-09-11; each model links to its official pricing page from Settings. Unknown or unavailable values are not treated as zero. Small positive amounts appear as less than $0.01.

The panel labels the result as an API estimate with an assumed mix. The hover explanation lists every assumption. This is not a subscription bill and does not infer the actual model distribution. Last 30 Days uses only reported account days. Tool fees and service-tier modifiers are excluded.

Official price sources:
- https://developers.openai.com/api/docs/models/gpt-5.6-sol
- https://developers.openai.com/api/docs/models/gpt-6-astra
- https://developers.openai.com/api/docs/models/gpt-5.6-terra
- https://developers.openai.com/api/docs/models/gpt-5.6-luna

Calculation runs on existing account data with no additional network polling, background timers or session scans. Settings persist across restarts. Earlier Share and account-history fixes remain included.
