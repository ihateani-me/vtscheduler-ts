# vtscheduler
A backend scheduler that will track VTuber live stream (and archive) for Youtube, ~~Bilibili~~, Twitch, Twitcasting<br>
Written in Typescript, and using Mongoose.

## Implementation
- [x] YouTube Implementation
- [ ] Bilibili Implementation
- [x] Twitch Implementation
- [x] Twitcasting Implementation

BiliBili Implementation is a little bit hindered because rate limiting, currently working around the limitation :smile:

## Installation
1. Install Node.js and Prepare a MongoDB Server
2. Run `npm install`
3. Run `npm install -g ts-node`

## Preparation

You need to have MongoDB Server up and running at localhost or Mongo Atlas

### Youtube streams
You need:
- Youtube Data API v3

There's a limit of 10k request per day, so you might want to ask google
or try to get another API key that will be rotated

### Twitch Streams
You need: Twitch API Key, register a new application on your Developer Console

That will create a Client ID and Client Secret for you to use.

## Configuration
Configure the scheduler in [src/config.json](src/config.json.example)<br>
Rename the config.json.example to config.json<br>

```json
{
    "mongodb": {
        "uri": "mongodb://127.0.0.1:27017",
        "dbname": "vtapi"
    },
    "youtube": {
        "api_keys": [],
        "rotation_rate": 60
    },
    "twitch": {
        "client_id": null,
        "client_secret": null
    },
    "workers": {
        "youtube": true,
        "bilibili": true,
        "twitch": false,
        "twitcasting": true
    },
    "intervals": {
        "bilibili": {
            "channels": "*/60 */2 * * *",
            "upcoming": "*/4 * * * *",
            "live": "*/2 * * * *"
        },
        "youtube": {
            "channels": "*/60 */2 * * *",
            "feeds": "*/2 * * * *",
            "live": "*/1 * * * *",
            "missing_check": "*/5 * * * *"
        },
        "twitcasting": {
            "channels": "*/60 */2 * * *",
            "live": "*/1 * * * *"
        },
        "twitch": {
            "channels": "*/60 */2 * * *",
            "live": "*/1 * * * *"
        }
    }
}
```

**Explanation**:
- mongodb
  - **url**: the MongoDB Server URL without trailing slash at the end
  - **dbname**: the database name that will be used
- youtube
  - **api_keys**: collection of Youtube Data API v3 Keys you want to use
  - **rotation_rate**: the rate of the API will be rotated in minutes
- twitch
  - **client_id**: Twitch Application Client ID
  - **client_secret**: Twitch Application Client Secret
- workers:
  - **youtube**: enable Youtube scheduler (ensure that your API keys is enough)
  - **bilibili**: enable bilibili scheduler
  - **twitch**: enable Twitch scheduler (ensure you have Client ID and Secret put)
  - **twitcasting**: enable Twitcasting scheduler
- **intervals**: self-explanatory, all of those are in cron-style time<br>
  If you need help refer here: [crontab.guru](https://crontab.guru/)<br>
  You can also disable the workers by putting `null` instead of the crontab styles

## Running
Make sure you've already configured the config.json and the MongoDB server is up and running

The next thing you need to do is filter what you want and what do you not want for the database.<br>
You can do that by adding the word `.mute` to file in `database/dataset`

Example, you dont want to scrape Hololive data, then rename it from `hololive.json` to `hololive.json.mute`<br>

### Database setup and Channel Models
1. Run `npm run database`, this will run the database creation handler
2. After the manager part came out, press `2`, this will start the initial scrapping process

If you have something changed, you could run that again to update the Channel Models<br>
If you just removed something, you want to run `3` then `2` to reset it.

### Deployment
Its recommended to split the worker into separate server or process to avoid rate-limiting.

After that you need to rename `skip_run.json.example` to `skip_run.json` and add anything you dont need on that server.<br>
Do that on every other server.