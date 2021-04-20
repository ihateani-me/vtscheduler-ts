import _ from "lodash";
import { DateTime, Duration } from "luxon";

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
        this.rate = minute_rate;

        this.lastForced = -1;
        this.fillUpKeys();

        this.next_rotate = this.determineStart();
    }

    private determineStart(): number {
        let currentDay = DateTime.utc().startOf("day");
        let currentHour = DateTime.utc().startOf("hour");
        let diffs = currentHour.diff(currentDay);
        let repeating_time = Math.floor(Math.abs(diffs.as("minutes")) / this.rate);
        logger.info(`YTRotatingAPIKey.determineStart() Adjusting with current hour, rotating ${repeating_time} times`);
        _.times(repeating_time, () => this.rotate());
        return currentHour.plus({minutes: this.rate}).toSeconds();
    }

    private fillUpKeys() {
        let HOUR = this.rate / 60;
        let HOUR_M = HOUR;
        let MAX = 0;
        while (HOUR_M <= 24) {
            MAX++;
            HOUR_M += HOUR;
        }
        if (this.api_keys.length >= MAX) {
            // Ignore if it's went past or equal to 24 keys
            return;
        }
        logger.info(`YTRotatingAPIKey.fillUpKeys() need ${MAX - this.api_keys.length} more keys, filling up with the same keys over and over.`);
        while (this.api_keys.length <= MAX) {
            this.api_keys = _.concat(this.api_keys, this.api_keys);
        }
        this.api_keys = this.api_keys.slice(0, MAX);
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
    private checkTime() {
        let current = DateTime.utc();
        if (current.toSeconds() >= this.next_rotate) {
            let ctext = current.toISO();
            logger.info("YTRotatingAPIKey.checkTime() Rotating API key...");
            this.next_rotate = DateTime.fromSeconds(this.next_rotate, {zone: "UTC"}).plus({minutes: this.rate}).toSeconds();
            logger.info(`YTRotatingAPIKey.checkTime() Next API rotate: ${ctext}`);
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
            this.checkTime();
        }
        return this.api_keys[0];
    }

    forceRotate(): void {
        if (this.lastForced === -1) {
            logger.info(`YTRotatingAPIKey.forceRotate() force rotating keys, shifting next rotation by ${this.rate} minutes`);
            this.lastForced = DateTime.utc().toSeconds();
            this.next_rotate = DateTime.fromSeconds(this.next_rotate, {zone: "UTC"}).plus({minutes: this.rate}).toSeconds();
            this.rotate();
            return;
        }
        // 15 seconds inverval guard
        let current = DateTime.utc().toSeconds() - 15;
        if (current > this.lastForced) {
            logger.info(`YTRotatingAPIKey.forceRotate() force rotating keys, shifting next rotation by ${this.rate} minutes`);
            this.lastForced = current + 15;
            this.next_rotate = DateTime.fromSeconds(this.next_rotate, {zone: "UTC"}).plus({minutes: this.rate}).toSeconds();
            this.rotate();
            return;
        }
    }
}
