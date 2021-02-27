import _ from "lodash";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import moment from "moment-timezone";

import { logger } from "./logger";
import { isNone } from "./swissknife";
import { resolveDelayCrawlerPromises } from "./crawler";

import { version as vt_version } from "../../package.json";


interface AnyDict {
    [key: string]: any;
}

export class TwitchHelix {
    private cid: string
    private csc: string

    private nextReset: number
    private remainingBucket: number

    private session: AxiosInstance
    private authorized: boolean
    private bearer_token?: string
    private expires: number

    BASE_URL: string
    OAUTH_URL: string

    constructor(client_id: string, client_secret: string) {
        this.bearer_token = undefined;
        this.expires = 0;
        this.cid = client_id;
        this.csc = client_secret;
        this.session = axios.create({
            headers: {"User-Agent": `vtschedule-ts/${vt_version} (https://github.com/ihateani-me/vtscheduler-ts)`}
        })
        this.authorized = false;

        this.BASE_URL = "https://api.twitch.tv/helix/";
        this.OAUTH_URL = "https://id.twitch.tv/oauth2/";

        this.nextReset = -1;
        this.remainingBucket = -1;

        this.session.interceptors.response.use(this.handleRateLimitResponse.bind(this), (error) => {
            return Promise.reject(error);
        })
        this.session.interceptors.request.use(this.handleRateLimitRequest.bind(this), (error) => {
            return Promise.reject(error);
        })
    }

    private delayBy(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private current() {
        return moment.tz("UTC").unix();
    }

    private async handleRateLimitRequest(config: AxiosRequestConfig): Promise<AxiosRequestConfig> {
        if (this.remainingBucket < 1 && this.remainingBucket !== -1) {
            let currentTime = moment.tz("UTC").unix();
            if (this.nextReset > currentTime) {
                logger.info(`TwitchHelix.handleRateLimit() currently rate limited, delaying by ${this.nextReset - currentTime} seconds`)
                await this.delayBy((this.nextReset - currentTime) * 1000);
            }
        }
        return config;
    }

    private handleRateLimitResponse(response: AxiosResponse<any>): AxiosResponse<any> | Promise<AxiosResponse<any>> {
        this.nextReset = parseInt(_.get(response.headers, "ratelimit-reset", this.nextReset));
        this.remainingBucket = parseInt(_.get(response.headers, "ratelimit-remaining", this.remainingBucket));
        return response;
    }

    // @ts-ignore
    private async getReq(url: string, params: AnyDict, headers: AnyDict = null) {
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
            let resp = await this.session.get(`${url}?${param_url}`);
            return resp.data;
        } else {
            let resp = await this.session.get(`${url}?${param_url}`, {
                headers: headers
            })
            return resp.data;
        }
    }

    // @ts-ignore
    private async postReq(url: string, params: AnyDict, headers: AnyDict = null) {
        if (isNone(headers)) {
            let resp = await this.session.post(url, null, {
                params: params
            })
            return resp.data;
        } else {
            let resp = await this.session.post(url, null, {
                params: params,
                headers: headers
            })
            return resp.data;   
        }
    }

    async expireToken() {
        let params = {"client_id": this.cid, "token": this.bearer_token};
        if (this.authorized) {
            logger.info("twitchHelix.expireToken() de-authorizing...");
            await this.postReq(this.OAUTH_URL + "revoke", params);
            logger.info("twitchHelix.expireToken() de-authorized.");
            this.expires = 0;
            this.bearer_token = undefined;
            this.authorized = false;
        }
    }

    async authorizeClient() {
        let params = {"client_id": this.cid, "client_secret": this.csc, "grant_type": "client_credentials"};
        logger.info("twitchHelix.authorizeClient() authorizing...");
        let res = await this.postReq(this.OAUTH_URL + "token", params);
        this.expires = this.current() + res["expires_in"];
        this.bearer_token = res["access_token"];
        logger.info("twitchHelix.authorizeClient() authorized.");
        this.authorized = true;
    }

    async fetchLivesData(usernames: string[]) {
        if (!this.authorized) {
            logger.warn("twitchHelix.fetchLivesData() You're not authorized yet, requesting new bearer token...");
            await this.authorizeClient();
        }
        if (this.current() >= this.expires) {
            logger.warn("twitchHelix.fetchLivesData() Token expired, rerequesting...");
            await this.authorizeClient();
        }

        let chunkedUsernames = _.chunk(usernames, 90);
        const headers = {
            "Authorization": `Bearer ${this.bearer_token}`,
            "Client-ID": this.cid
        }

        const chunkedPromises: Promise<any[]>[] = chunkedUsernames.map((username_sets, idx) => (
            this.getReq(this.BASE_URL + "streams", _.concat(["first=100"], _.map(username_sets, (o) => `user_login=${o}`)), headers)
            .then((results: any) => {
                return results["data"];
            }).catch((error: any) => {
                logger.error(`Failed to fetch chunk ${idx}, ${error.toString()}`);
                return [];
            })
        ))
        const chunkedPromisesDelayed = resolveDelayCrawlerPromises(chunkedPromises, 500);
        const returnedPromises = await Promise.all(chunkedPromisesDelayed);
        return _.flattenDeep(returnedPromises);
    }

    async fetchChannels(usernames: string[]) {
        if (!this.authorized) {
            logger.warn("twitchHelix.fetchChannels() You're not authorized yet, requesting new bearer token...");
            await this.authorizeClient();
        }
        if (this.current() >= this.expires) {
            logger.warn("twitchHelix.fetchChannels() Token expired, rerequesting...");
            await this.authorizeClient();
        }

        const headers = {
            "Authorization": `Bearer ${this.bearer_token}`,
            "Client-ID": this.cid
        }
        let chunkedUsernames = _.chunk(usernames, 90);
        const chunkedPromises: Promise<any[]>[] = chunkedUsernames.map((username_sets, idx) => (
            this.getReq(this.BASE_URL + "users", _.map(username_sets, (o) => `login=${o}`), headers)
            .then((results: any) => {
                return results["data"];
            }).catch((error: any) => {
                logger.error(`Failed to fetch chunk ${idx}, ${error.toString()}`);
                return [];
            })
        ))
        const chunkedPromisesDelayed = resolveDelayCrawlerPromises(chunkedPromises, 500);
        const returnedPromises = await Promise.all(chunkedPromisesDelayed);
        return _.flattenDeep(returnedPromises);
    }

    async fetchChannelFollowers(user_id: string) {
        if (!this.authorized) {
            logger.warn("twitchHelix.fetchChannelFollowers() You're not authorized yet, requesting new bearer token...");
            await this.authorizeClient();
        }
        if (this.current() >= this.expires) {
            logger.warn("twitchHelix.fetchChannelFollowers() Token expired, rerequesting...");
            await this.authorizeClient();
        }

        let headers = {
            "Authorization": `Bearer ${this.bearer_token}`,
            "Client-ID": this.cid
        }
        let params: string[] = [`to_id=${user_id}`];
        let res = await this.getReq(this.BASE_URL + "users/follows", params, headers);
        return res;
    }

    async fetchChannelVideos(user_id: string) {
        if (!this.authorized) {
            logger.warn("twitchHelix.fetchChannelFollowers() You're not authorized yet, requesting new bearer token...");
            await this.authorizeClient();
        }
        if (this.current() >= this.expires) {
            logger.warn("twitchHelix.fetchChannelFollowers() Token expired, rerequesting...");
            await this.authorizeClient();
        }

        let headers = {
            "Authorization": `Bearer ${this.bearer_token}`,
            "Client-Id": this.cid
        }
        let params_base: string[] = [`user_id=${user_id}`];
        let main_results = [];
        let res = await this.getReq(this.BASE_URL + "videos", [params_base[0], "first=50"], headers);
        main_results.push(res["data"]);
        if (Object.keys(res["pagination"]).length < 1) {
            return main_results;
        }
        if (_.has(res["pagination"], "cursor")) {
            if (isNone(res["pagination"]["cursor"]) || !res["pagination"]["cursor"]) {
                return main_results;
            }
        }
        let next_page = res["pagination"]["cursor"];
        if (isNone(next_page) || !next_page) {
            return main_results;
        }
        let doExit = false;
        while (!doExit) {
            let next_res = await this.getReq(this.BASE_URL + "videos", [params_base[0], `after=${next_page}`], headers);
            main_results.push(next_res["data"]);
            if (Object.keys(res["pagination"]).length < 1) {
                break;
            }
            if (_.has(res["pagination"], "cursor")) {
                if (isNone(res["pagination"]["cursor"]) || !res["pagination"]["cursor"]) {
                    doExit = true;
                    break;
                }
            }
            if (doExit) {
                break;
            }
            next_page = next_res["pagination"]["cursor"];
            if (isNone(next_page) || !next_page) {
                break;
            }
        }
        main_results = _.flattenDeep(main_results);
        return main_results;
    }
}

interface StreamScheduleGQL {
    id: string
    isCancelled: boolean
    cancelledUntil: string | null
    startAt: string
    endAt: string
    title: string
}

export class TwitchGQL {
    private session: AxiosInstance;
    private gqlSchemas: string;

    constructor() {
        this.session = axios.create({
            baseURL: "https://gql.twitch.tv",
            headers: {
                "Client-Id": "kimne78kx3ncx6brgo4mv6wki5h1ko",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.190 Safari/537.36",
                "Content-Type": "application/json"
            }
        })

        this.gqlSchemas = `query StreamSchedule($login:String,$startDate:Time) {
            user(login:$login) {
                channel {
                    schedule {
                        id
                        segments(startingWeekday:"MONDAY",relativeDate:$startDate) {
                            id
                            isCancelled
                            cancelledUntil
                            startAt
                            endAt
                            title
                        }
                    }
                }
            }
        }`;
    }

    async getSchedules(loginName: string, overrideTime?: string): Promise<[StreamScheduleGQL[], any]> {
        // sample: 2021-02-28T16:59:59.059Z
        const relativeTime = moment.utc().format("YYYY-MM-DD[T]HH:mm:ss.SSS[Z]");
        const variables = {
            "login": loginName,
            "startDate": isNone(overrideTime) ? relativeTime : overrideTime,
        }

        let response: AxiosResponse<any>;
        try {
            response = await this.session.post("/gql", {
                query: this.gqlSchemas,
                variables: variables,
                operationName: "StreamSchedule",
            });
        } catch (err) {
            logger.error(`twitchGQL.getSchedules() failed to fetch schedule for ${loginName}, ${err.toString()}`);
            return [[], err];
        }

        const schedulesNode = _.get(response.data, "data.user.channel.schedule");
        if (schedulesNode === null) {
            // No schedules
            return [[], null];
        }
        const scheduleSegments = _.get(schedulesNode, "segments", []);
        return [scheduleSegments, null];
    }
}
