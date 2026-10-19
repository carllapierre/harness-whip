export type ObjectValue = Record<string, unknown>;

export function object(value: unknown): ObjectValue {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as ObjectValue)
        : {};
}

export function array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function text(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

export function numeric(value: unknown, fallback = NaN): number {
    return typeof value === "number" ? value : fallback;
}

export function uuid(value: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error("Expected an exact conversation UUID");
    }
    return value.toLowerCase();
}

export function canonical(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
        return `{${Object.entries(object(value))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
