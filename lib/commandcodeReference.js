// Published reference data only. Never pass this to normalizeUsage or a provider state.
export const COMMANDCODE_USAGE_URL = 'https://commandcode.ai/usage';
export const GOAT_REFERENCE = Object.freeze({
    title: 'GOAT · documented plan limits',
    price: '$10/month · published plan, not your detected subscription',
    limits: '70 credits per billing cycle · 14 per 5 hours · 35 per 7 days',
    note: 'Usage-value credits; model allowances vary. Top-ups are separate. Usage windows reset from first use. These are not your balance or consumption.',
    checked: 'Documentation checked 3 Oct 2026',
    source: 'https://commandcode.ai/docs/resources/usage-limits',
});
