import { migrate_MergeCollection_20200205 } from "./2021-02-05-merge-collection";
import { createInterface } from 'readline';
import { fallbackNaN } from "../../src/utils/swissknife";

const MIGRATIONS = [
    {
        date: "2021-02-05",
        name: "Collection merging to Video, Channels, Channels Stats History, and Viewers Data",
        func: migrate_MergeCollection_20200205
    },
]

export async function Migrator() {
    let log_msg = `------------ Database Migrator ------------
    Select one of the database migration below!
    -------------------------------------------`;
    for (let i = 0; i < MIGRATIONS.length; i++) {
        log_msg += `[${i + 1}] ${MIGRATIONS[i].name} (${MIGRATIONS[i].date})\n`
    }
    log_msg += `[${MIGRATIONS.length + 1}] Exit`;
    let exit_num = (MIGRATIONS.length + 1).toString();
    const int = createInterface(process.stdin, process.stdout);
    let do_exit = false;
    while (!do_exit) {
        console.clear();
        console.log(log_msg);
        int.question("Select: ", async input => {
            int.close();
            if (input === exit_num) {
                do_exit = true;
                delayEnd();
            } else {
                await migrateInternal(input);
                delayEnd();
            }
        })
    }
    return;
}

const delayEnd = () => setTimeout(() => {
    console.log("Press any key to continue");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', console.log.bind(console, "\n"));
}, 600);

async function migrateInternal(selection: string) {
    let select = fallbackNaN(parseInt, selection, null);
    if (select === null) {
        console.log("[Migrator] Unknown number");
        setTimeout(() => {return;}, 500);
        return;
    } else if (select < MIGRATIONS.length || select > MIGRATIONS.length) {
        console.log("[Migrator] Number out of range");
        setTimeout(() => {return;}, 500);
        return;
    }
    select -= 1;
    let MIGRATE = MIGRATIONS[select];
    console.info(`[Migrator] Executing Migration ${MIGRATE.name} (${MIGRATE.date})`);
    await MIGRATE.func();
    console.info(`[Migrator] Migration ${MIGRATE.name} (${MIGRATE.date}) ==> Executed!`);
    setTimeout(() => {return;}, 1000);
}
