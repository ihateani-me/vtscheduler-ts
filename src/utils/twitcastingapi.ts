import _ from "lodash";
import axios, { AxiosInstance } from "axios"
import FormData from "form-data";

import { resolveDelayCrawlerPromises } from "./crawler";
import { logger } from "./logger";

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36";

export interface TwitcastingResponse {
    is_live: boolean
    id?: string
    title?: string
    channel_id?: string
    group?: string
    viewers?: string
    peakViewers?: string
    startTime?: number
    is_member?: boolean
    thumbnail?: string
}

function getAPIURL(type: string, movieId: number) {
    if (type === "thumb") {
        return `https://apiv2.twitcasting.tv/users/${movieId}/live/thumbnail`;
    }
    return `https://frontendapi.twitcasting.tv/movies/${movieId}/${type}`;
}

export class TwitcastingAPI {
    session: AxiosInstance
    static session: AxiosInstance = axios.create({
        headers: {
            "User-Agent": CHROME_UA
        }
    });

    constructor() {
        this.session = axios.create({
            headers: {
                "User-Agent": CHROME_UA,
            }
        })
    }

    static async getToken(movieId: string | number): Promise<string> {
        let form = new FormData();
        form.append("movie_id", movieId.toString());
        let res = await this.session.post("ttps://twitcasting.tv/happytoken.php", form, {
            params: {
                "__n": new Date().getTime()
            },
            headers: form.getHeaders(),
            responseType: "json"
        })
        let tokenData = res.data;
        let token: string = tokenData["token"];
        return token;
    }

    static async checkLives(user_id: string): Promise<number | null> {
        let res = await this.session.post(`https://frontendapi.twitcasting.tv/users/${user_id}/latest-movie`, null, {
            params: {
                "__n": new Date().getTime()
            }
        });

        let movieData = res.data["movie"];
        if (movieData["is_on_live"]) {
            return movieData["id"];
        }
        return null;
    }

    static async getLivesInfo(user_id: string, group: string): Promise<TwitcastingResponse> {
        let movie_id = await this.checkLives(user_id);
        if (movie_id === null) {
            return {
                is_live: false
            }
        }
        let token = await this.getToken(movie_id);
        let defaultParams = {token: token, __n: new Date().getTime()};
        let thumbParams = {"size": "large", "position": "beginning"};

        let promises = ["info", "status/viewer", "thumb"].map((path) => (
            // @ts-ignore
            this.session.get(getAPIURL(path, movie_id), {
                params: path === "thumb" ? thumbParams : defaultParams,
            }).then((res) => {
                let data = res.data;
                if (path === "thumb") {
                    data = res.request.res.responseUrl;
                }
                return {"type": path, "data": data, "user": user_id, "group": group};
            }).catch((err) => {
                logger.error(`TwitcastingAPI.getLivesInfo() failed to fetch ${path} for ${user_id}, ${err.toString()}`);
                return {"type": path, "data": path === "thumb" ? "" : {}, "user": user_id, "group": group};
            })
        ))
        let wrappedPromises: Promise<{
            type: string;
            data: any;
            user: string;
            group: string;
        } | {
            type: string;
            data: {};
            user: string;
            group: string;
        }>[] = resolveDelayCrawlerPromises(promises, 250);
        let pureResults = await Promise.all(wrappedPromises);
        let returnData: TwitcastingResponse = {
            "is_live": true,
            "id": movie_id.toString(),
            "channel_id": pureResults[0].user,
            "group": pureResults[0].group,
        };
        for (let i = 0; i < pureResults.length; i++) {
            let data = pureResults[i].data;
            let path = pureResults[i].type;

            if (path === "info") {
                returnData["startTime"] = _.get(data, "started_at", undefined);
                let visibility = _.get(data, "visibility", {});
                let is_member = _.get(visibility, "type", "public") === "public" ? false : true;
                returnData["is_member"] = is_member;
            }
            if (path === "status/viewer") {
                let movieData = _.get(data, "movie", {});
                returnData["title"] = _.get(movieData, "title", `Radio Live #${movie_id}`);
                let viewersData = _.get(movieData, "viewers", {});
                // @ts-ignore
                returnData["viewers"] = _.get(viewersData, "current", null);
                // @ts-ignore
                returnData["peakViewers"] = _.get(viewersData, "total", null);
            }
            if (path === "thumb") {
                returnData["thumbnail"] = data;
            }
        }
        return returnData;
    }
}