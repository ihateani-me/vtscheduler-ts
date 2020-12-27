import _ from "lodash";
import moment from "moment-timezone";
import { logger } from "./logger";

export class YTRotatingAPIKey {
    private api_keys: string[];
    private count: number;
    private rate: number;
    private next_rotate: number;
    private lastForced: number;

    /**
     * A class to rotate API key based on rotation rate
     * @param api_keys A set of API keys on a list
     * @param minute_rate A rotation rate in minutes, defaults to 60 minutes
     */
    constructor(api_keys: string | string[], minute_rate: number = 60) {
        if (typeof api_keys === "string") {
            this.api_keys = [api_keys];
        } else {
            this.api_keys = api_keys;
        }
        this.count = this.api_keys.length;
        this.rate = minute_rate * 60;
        this.next_rotate = moment.tz("UTC").unix() + this.rate;

        this.lastForced = -1;
    }

    private rotate() {
        // @ts-ignore
        this.api_keys.push(this.api_keys.shift());
    }

    /**
     * Internal time checking, it will be run automatically if you have more
        than one API keys when you initialized the class.

        This is internal function and can't be called outside from the class.

        Rotation method:

        If the time already passed the next_rotate time it will rotate the key
        forward and set the next_rotate time with the applied rate

        Ex:

        Provided: ["api_a", "api_b", "api_c"]

        Next rotation (1): ["api_b", "api_c", "api_a"]

        Next rotation (2): ["api_c", "api_a", "api_b"]

        Next rotation (3/Full rotate): ["api_a", "api_b", "api_c"]
     */
    private check_time() {
        let current = moment.tz("UTC");
        if (current.unix() >= this.next_rotate) {
            let ctext = current.format();
            logger.info("[YTRotatingAPI] Rotating API key...");
            this.next_rotate = current.unix() + this.rate;
            logger.info(`[YTRotatingAPI] Next API rotate: ${ctext}`);
            this.rotate();
        }
    }

    /**
     * Fetch the first API keys
        the first api keys will always be different since
        the rotation check are always called everytime this functioon
        are called.
     */
    get(): string {
        if (this.count > 1) {
            this.check_time();
        }
        return this.api_keys[0];
    }

    forceRotate(): void {
        if (this.lastForced === -1) {
            this.lastForced = moment.tz("UTC").unix();
            this.rotate();
            return;
        }
        // 15 seconds inverval guard
        let current = moment.tz("UTC").unix() - 15;
        if (current > this.lastForced) {
            this.lastForced = current + 15;
            this.rotate();
            return;
        }
    }
}
