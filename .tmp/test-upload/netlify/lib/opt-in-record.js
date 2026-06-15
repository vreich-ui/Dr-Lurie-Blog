export const isParseBodyFailure = (result) => {
    return Boolean(result && 'ok' in result && result.ok === false);
};
export const getHeader = (headers, name) => {
    const normalizedName = name.toLowerCase();
    const match = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === normalizedName);
    return match?.[1];
};
const toStringValue = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
export const parseBody = (event) => {
    if (!event.body) {
        return undefined;
    }
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const contentType = getHeader(event.headers, 'content-type') ?? '';
    if (contentType.includes('application/json')) {
        let parsed;
        try {
            parsed = JSON.parse(body);
        }
        catch {
            return { ok: false, reason: 'malformed-json' };
        }
        return parsed && typeof parsed === 'object' ? parsed : undefined;
    }
    if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(body);
        return Object.fromEntries(params.entries());
    }
    return undefined;
};
export const buildRecord = (input, userAgent) => {
    const formName = toStringValue(input.formName) ?? toStringValue(input['form-name']);
    if (!formName) {
        return undefined;
    }
    const consent = toStringValue(input.consentText) ?? toStringValue(input.consentType) ?? toStringValue(input.consent);
    const source = toStringValue(input.source) ?? toStringValue(input.pathname);
    const record = {
        formName,
        submittedAt: new Date().toISOString(),
    };
    const email = toStringValue(input.email);
    const name = toStringValue(input.name);
    if (email) {
        record.email = email;
    }
    if (name) {
        record.name = name;
    }
    if (source) {
        record.source = source;
    }
    if (consent) {
        record.consent = consent;
    }
    if (userAgent) {
        record.userAgent = userAgent;
    }
    return record;
};
