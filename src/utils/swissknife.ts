export type Nullable = null | undefined;
export type NullableOr<T> = T | null;

/**
 * Check if the variable is a null type or not.
 * @param { any } key - things that want to be checked.
 * @returns { boolean } `true` or `false`
 */
export function isNone(key: any, checkEmpty: boolean = false): key is Nullable {
    if (typeof key === "undefined") {
        return true;
    } else if (key === null) {
        return true;
    }
    if (checkEmpty) {
        if (typeof key === "object") {
            if (Array.isArray(key)) {
                if (key.length < 1) {
                    return true;
                }
                return false;
            } else {
                if (Object.keys(key).length < 1) {
                    return true;
                }
                return false;
            }
        } else if (typeof key === "string") {
            if (key.length < 1 || key === "" || key === " ") {
                return true;
            }
            return false;
        }
    }
    return false;
}

/**
 * Filter out data that provided and remove all empty string from Array.
 * @param { any[] } data - Data that need to be filtered.
 * @returns { any[] } Data that has been filtered.
 */
export function filterEmpty(data: any[]): any[] {
    let filtered: string[] = [];
    if (isNone(data)) {
        return [];
    }
    data.forEach((val) => {
        if (val) {
            filtered.push(val);
        }
    });
    return filtered;
}

/**
 * Convert a string/number to a number using fallback if it's NaN (Not a number).
 * If fallback is not specified, it will return to_convert.
 * @param cb parseFloat or parseInt function that will be run
 * @param to_convert number or string to convert
 * @param fallback fallback number
 */
export function fallbackNaN(cb: Function, to_convert: any, fallback?: any): any {
    if (isNaN(cb(to_convert))) {
        return isNone(fallback) ? to_convert : fallback;
    } else {
        return cb(to_convert);
    }
}
