const fs = require("fs");
const path = require("path");
const ajv = require("ajv").default

console.info("[Validator] Reading JSON schemas...");
let schemasPath = path.join(__dirname, "..", "database", "schemas.json");
let datasetPath = path.join(__dirname, "..", "database", "dataset");
let datasets = fs.readdirSync(datasetPath).filter((f) => f.endsWith(".json"));
let schemas = JSON.parse(fs.readFileSync(schemasPath).toString());

const Ajv = new ajv({
    strict: false
});
const validator = Ajv.compile(schemas);

console.info("[Validator] Probing dataset directory...");
let readDatasets = datasets.map((f) => {
    let realPath = path.join(datasetPath, f);
    let parsedDataset = JSON.parse(fs.readFileSync(realPath).toString());
    let groupNameSplit = f.split(".");
    let groupName = groupNameSplit.slice(0, groupNameSplit.length - 1).join(".");
    let result = {};
    result["name"] = groupName;
    result["data"] = parsedDataset;
    return result;
})

console.info("[Validator] Start validating file...");
let error = [];
for (let i = 0; i < readDatasets.length; i++) {
    let vtdata = readDatasets[i];
    process.stdout.write(`[Validator] Validating "${vtdata.name}"`);
    let vt_valid = validator(vtdata.data);
    if (vt_valid) {
        process.stdout.write(" -- Valid!\n");
    } else {
        process.stdout.write(" -- INVALID!\n");
        validator.errors.forEach((err, idx) => {
            console.error(`  - ${idx + 1}. ${err.message} [${err.keyword}]`);
        });
        error.push(vtdata.name);
    }
}

if (error.length > 1) {
    throw new Error(`Some data failed to be validated\nThey're: ${error.join(", ")}`);
} else {
    console.info("[Validator] Finished validating!");
}