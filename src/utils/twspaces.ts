/**
 * Implementation of Twitter Spaces API.
 * This is just a simple wrapper around the Twitter API.
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { chunk, concat, flattenDeep, get } from "lodash";
import { DateTime } from "luxon";
import { URL } from "url";

import { logger } from "./logger";

import { version as vt_version } from "../../package.json";
import { isNone, NullableOr } from "./swissknife";
import { resolveDelayCrawlerPromises } from "./crawler";


type AnyDict = {[key: string]: any};


export interface RawSpacesData {
    id: string;
    title: string;
    participant_count: number;
    state: "live" | "scheduled" | "ended";
    creator_id: string;
    started_at: string;
    created_at: string;
    is_ticketed: boolean;
    scheduled_start?: string;
}

export interface RawUserMetricsData {
    followers_count: number;
    following_count: number;
    tweet_count: number;
    listed_count: number;
}

interface RawUserBasicData {
    id: string;
    name: string;
    username: string;
}

export interface RawUserData extends RawUserBasicData {
    description: string;
    created_at: string;
    profile_image_url: string;
    public_metrics?: RawUserMetricsData;
}

export interface SpacesRequestData {
    spaces: RawSpacesData[];
    users: RawUserBasicData[];
}

export class TokenBucket {
    id: string;

    nextReset: number;
    remainingBucket: number;

    constructor(id: string, reset: number, bucket: number) {
        this.id = id;
        // UNIX Timestamp
        this.nextReset = reset;
        this.remainingBucket = bucket;
    }

    private delayBy(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private current() {
        return Math.floor(DateTime.utc().toSeconds());
    }

    async handleRateLimit() {
        if (this.remainingBucket < 1 && this.remainingBucket !== 1) {
            let currentTime = this.current();
            if (this.nextReset > currentTime) {
                logger.info(
                    `Twitter.TokenBucket.handleRateLimit() currently rate limited, delaying by ${
                        this.nextReset - currentTime
                    } seconds`
                );
                await this.delayBy((this.nextReset - currentTime) * 1000);
            }
        }
    }
}

type BucketHandler = {[key: string]: TokenBucket};

function hashRoute(rr: string): string {
    return rr.split("").reduce((a, b) => {
        a = ((a << 5) - a) + b.charCodeAt(0);
        return a & a;
    }, 0).toString();
}


export class TwitterAPI {
    private session: AxiosInstance;
    private bucket: BucketHandler;

    BASE_V1: string;
    BASE_v2: string;

    constructor(token: string) {
        this.session = axios.create(
            {
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`,
                }
            }
        )

        this.BASE_V1 = "https://api.twitter.com/1.1/";
        this.BASE_v2 = "https://api.twitter.com/2/";
        this.bucket = {};

        this.session.interceptors.response.use(this.handleRateLimitResponse.bind(this), (err) => {
            return Promise.reject(err);
        });
        this.session.interceptors.request.use(this.handleRateLimitRequest.bind(this), (error) => {
            return Promise.reject(error);
        });
    }

    getBucket(id: string) {
        logger.info(`TwitterAPI.getBucket(): Fetching bucket ${id}`);
        let bucket = get(this.bucket, id, null);
        if (isNone(bucket)) {
            bucket = new TokenBucket(id, -1, -1);
            this.bucket[id] = bucket;
        }
        return bucket;
    }

    updateBucket(id: string, reset: number, remaining: number) {
        logger.info(`TwitterAPI.updateBucket(): Updating bucket ${id} (${remaining} - ${reset})`);
        let bucket = get(this.bucket, id, null);
        if (isNone(bucket)) {
            bucket = new TokenBucket(id, -1, -1);
        }
        bucket.nextReset = reset;
        bucket.remainingBucket = remaining;
        this.bucket[id] = bucket;
        return bucket;
    }

    private async handleRateLimitRequest(config: AxiosRequestConfig): Promise<AxiosRequestConfig> {
        const url = config.url ?? this.BASE_v2;
        const reparsedURL = new URL(url);
        const bucket = this.getBucket(hashRoute(reparsedURL.pathname));
        if (bucket.nextReset < 0) {
            return config;
        }
        await bucket.handleRateLimit();
        return config;
    }

    private handleRateLimitResponse(
        response: AxiosResponse<any>
    ): AxiosResponse<any> | Promise<AxiosResponse<any>> {
        const url = response?.config.url ?? this.BASE_v2;
        const reparsedURL = new URL(url)
        const nextReset = parseInt(get(response.headers, "x-rate-limit-reset", -1));
        const remainingBucket = parseInt(get(response.headers, "x-rate-limit-remaining", -1));
        this.updateBucket(hashRoute(reparsedURL.pathname), nextReset, remainingBucket);
        return response;
    }

    private async getReq<T>(url: string, params: AnyDict, headers: NullableOr<AnyDict> = null): Promise<NullableOr<T>> {
        let param_url = "";
        if (typeof params === "object" && Array.isArray(params)) {
            param_url = params.join("&");
        } else if (typeof params === "object") {
            let s_ = [];
            for (let [key, val] of Object.entries(params)) {
                s_.push(`${key}=${val}`);
            }
            param_url = s_.join("&");
        } else if (typeof params === "string") {
            param_url = params;
        }
        if (isNone(headers)) {
            let resp = await this.session.get<T>(`${url}?${param_url}`);
            return resp.data;
        } else {
            let resp = await this.session.get<T>(`${url}?${param_url}`, {
                headers: headers,
            });
            return resp.data;
        }
    }

    async fetchUserSpaces(userIds: string[]): Promise<SpacesRequestData> {
        const chunkedRequest = chunk(userIds, 95);

        const chunkedPromises: Promise<SpacesRequestData>[] = chunkedRequest.map((userIdSets, idx) => 
            this.getReq(
                this.BASE_v2 + "spaces/by/creator_ids",
                concat(
                    [`user_ids=${userIdSets.join(",")}`],
                    ["space.fields=creator_id,id,created_at,title,started_at,scheduled_start,is_ticketed,participant_count,state"],
                    [`expansions=creator_id`]
                )
            )
                .then((results: any) => {
                    const dataResults = get(results, "data", []) as RawSpacesData[];
                    const userExpansions = get(results, "includes.users", []) as RawUserBasicData[];
                    return {
                        spaces: dataResults,
                        users: userExpansions,
                    }
                })
                .catch((err: Error) => {
                    logger.error(`TwitterAPI.fetchUserSpaces() failed to fetch chunk ${idx}`, err);
                    return {
                        spaces: [],
                        users: [],
                    };
                })
        );
        const chunkedPromisesDelayed = resolveDelayCrawlerPromises(chunkedPromises, 1000);
        const returnedPromises = await Promise.all(chunkedPromisesDelayed);

        const mergedData: SpacesRequestData = {
            spaces: [],
            users: [],
        };
        returnedPromises.forEach((info) => {
            mergedData.spaces = mergedData.spaces.concat(info.spaces);
            mergedData.users = mergedData.users.concat(info.users);
        });
        return mergedData;
    }

    async fetchSpaces(spaceIds: string[]): Promise<SpacesRequestData> {
        const chunkedRequest = chunk(spaceIds, 95);
        const chunkedPromises: Promise<SpacesRequestData>[] = chunkedRequest.map((spaceIdSets, idx) => 
            this.getReq(
                this.BASE_v2 + "spaces",
                concat(
                    [`ids=${spaceIdSets.join(",")}`],
                    ["space.fields=creator_id,id,created_at,title,started_at,scheduled_start,is_ticketed,participant_count,state"],
                    [`expansions=creator_id`]
                )
            )
            .then((results: any) => {
                const dataResults = get(results, "data", []) as RawSpacesData[];
                const userExpansions = get(results, "includes.users", []) as RawUserBasicData[];
                return {
                    spaces: dataResults,
                    users: userExpansions,
                }
            })
            .catch((err: Error) => {
                logger.error(`TwitterAPI.fetchSpaces() failed to fetch chunk ${idx}`, err);
                return {
                    spaces: [] as RawSpacesData[],
                    users: [] as RawUserBasicData[],
                };
            })
        );
        const chunkedPromisesDelayed = resolveDelayCrawlerPromises(chunkedPromises, 1000);
        const returnedPromises = await Promise.all(chunkedPromisesDelayed);

        const mergedData: SpacesRequestData = {
            spaces: [],
            users: [],
        };
        returnedPromises.forEach((info) => {
            mergedData.spaces = mergedData.spaces.concat(info.spaces);
            mergedData.users = mergedData.users.concat(info.users);
        });
        return mergedData;
    }

    async fetchUserIdFromUsername(usernames: string[]): Promise<RawUserData[]> {
        const chunkedRequest = chunk(usernames, 95);
        const chunkedPromises: Promise<RawUserData[]>[] = chunkedRequest.map((usernameSets, idx) => 
            this.getReq<RawUserData[]>(
                this.BASE_v2 + "users/by",
                concat(
                    [`usernames=${usernameSets.join(",")}`],
                    ["user.fields=created_at,description,public_metrics,profile_image_url"]
                )
            )
                .then((results) => {
                    return get(results, "data", []);
                })
                .catch((err: Error) => {
                    logger.error(`TwitterAPI.fetchUserIdFromUsername() failed to fetch chunk ${idx}`, err);
                    return [];
                })
        );
        const chunkedPromisesDelayed = resolveDelayCrawlerPromises(chunkedPromises, 1000);
        const returnedPromises = await Promise.all(chunkedPromisesDelayed);
        return flattenDeep(returnedPromises);
    }

    async fetchStatistics(userIds: string[]): Promise<RawUserData[]> {
        const chunkedRequest = chunk(userIds, 95);

        const chunkedPromises: Promise<RawUserData[]>[] = chunkedRequest.map((userIdSets, idx) => 
            this.getReq(
                this.BASE_v2 + "users",
                concat(
                    [`ids=${userIdSets.join(",")}`],
                    ["user.fields=created_at,description,public_metrics,profile_image_url"]
                )
            )
                .then((results: any) => {
                    return get(results, "data", []);
                })
                .catch((err: Error) => {
                    logger.error(`TwitterAPI.fetchStatistics() failed to fetch chunk ${idx}`, err);
                    return [];
                })
        );
        const chunkedPromisesDelayed = resolveDelayCrawlerPromises(chunkedPromises, 1000);
        const returnedPromises = await Promise.all(chunkedPromisesDelayed);
        return flattenDeep(returnedPromises);
    }
}