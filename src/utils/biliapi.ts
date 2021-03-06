import axios, {AxiosInstance} from "axios";

import { resolveDelayCrawlerPromises } from "./crawler";
import { logger } from "./logger";

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.150 Safari/537.36";

export interface BiliIDwithGroup {
    id: string
    group: string
}

async function biliChainedRequsts(session: AxiosInstance, mid: string, group: string) {
    const fetchUrl = ["https://api.bilibili.com/x/space/acc/info", "https://api.bilibili.com/x/web-interface/card"];
    let requestCallback = fetchUrl.map((url) => (
        session.get(url, {
            params: {
                mid: mid,
            },
            responseType: "json"
        })
        .then((result) => {
            let res = result.data;
            if (Math.abs(res["code"]) !== 0) {
                return {"is_error": true, "mid": mid, "res": {}, "url": url, "group": group};
            }
            return {"is_error": false, "mid": mid, "res": res["data"], "url": url, "group": group};
        }).catch((err) => {
            if (err.response) {
                let err_resp = err.response.data;
                let err_msg = err_resp["message"] || "No message"
                logger.error(`biliChainedRequsts() failed to process ${url} for ID ${mid}, got response ${err_resp["code"]}: ${err_msg}`);
            } else {
                logger.error(`biliChainedRequsts() failed to process ${url} for ID ${mid}, ${err.toString()}`);
            }
            return {"is_error": true, "mid": mid, "res": {}, "url": url, "group": group};
        })
    ))
    const wrapInDelay = resolveDelayCrawlerPromises(requestCallback, 350);
    const fetchedResults = await Promise.all(wrapInDelay);
    return fetchedResults;
}

export async function fetchChannelsMid(mids: BiliIDwithGroup[]) {
    let session = axios.create({
        headers: {
            "User-Agent": CHROME_UA
        }
    })
    let fetchChannels = mids.map((mid) => (
        biliChainedRequsts(session, mid["id"], mid["group"])
        .then((res) => {
            return res;
        }).catch((err) => {
            logger.error(`fetchChannelsMid() failed to fetch ID ${mid}, ${err.toString()}`);
            return [];
        })
    ));
    const wrapInDelay = resolveDelayCrawlerPromises(fetchChannels, 750);
    const parsedResults = await Promise.all(wrapInDelay);
    const cleanedResults: {
        is_error: boolean;
        mid: string;
        res: any;
        url: string;
        group: string;
    }[][] = parsedResults.filter(val => val.length > 0);
    return cleanedResults;
}