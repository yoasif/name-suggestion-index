const colors = require('colors/safe');
const fetch = require('node-fetch');
const fileTree = require('./lib/file_tree');
const fs = require('fs-extra');
const shell = require('shelljs');
const sort = require('./lib/sort');
const wdk = require('wikidata-sdk');

// Load and check brand files
let _brands = fileTree.read('brands');

let _toFetch = gatherQIDs(_brands);
let _qids = Object.keys(_toFetch);
if (!_qids.length) {
    console.log('Nothing to fetch');
    process.exit();
}

// split into several wikidata requests
let _urls = wdk.getManyEntities({
    ids: _qids, languages: ['en'], props: ['labels', 'descriptions'], format: 'json'
});

console.log(colors.green.bold(`\nFetching Wikidata details`));
doFetch(0);


function gatherQIDs(brands) {
    let toFetch = {};
    Object.keys(brands).forEach(k => {
        const qid = brands[k].tags['brand:wikidata'];
        if (qid && /^Q\d+$/.test(qid)) {
            toFetch[qid] = toFetch[qid] || [];
            toFetch[qid].push(k);
        }
    });

    return toFetch;
}


function doFetch(index) {
    if (index >= _urls.length) {
        return writeDocs('brands', _brands);
    }

    let currURL = _urls[index];
    console.log(colors.yellow.bold(`Batch ${index+1}/${_urls.length}`));

    fetch(currURL)
        .then(response => response.json())
        .then(processEntities)
        .catch(e => console.error(colors.red(e)))
        .then(() => delay(250))
        .then(() => { doFetch(++index); });
}


function processEntities(result) {
    Object.keys(result.entities).forEach(qid => {
        let entity = result.entities[qid];
        let label = entity.labels && entity.labels.en && entity.labels.en.value;
        let description = entity.descriptions && entity.descriptions.en && entity.descriptions.en.value;
        let brandKeys = _toFetch[qid];
        brandKeys.forEach(k => {
            _brands[k].wdLabel = label;
            _brands[k].wdDescription = description;
        });
    });
}


function delay(msec) {
    return new Promise((resolve) => setTimeout(resolve, msec));
}


function writeDocs(tree, obj) {
    console.log('\nwriting ' + tree);
    console.time(colors.green(tree + ' written'));
    let dict = {};

    // Start clean
    shell.rm('-rf', ['docs/brands']);

    // populate K-V dictionary
    Object.keys(obj).forEach(k => {
        let parts = k.split('|', 2);
        let tag = parts[0].split('/', 2);
        let key = tag[0];
        let value = tag[1];

        dict[key] = dict[key] || {};
        dict[key][value] = dict[key][value] || {};
        dict[key][value][k] = sort(obj[k]);

        if (dict[key][value][k].tags) {
            dict[key][value][k].tags = sort(obj[k].tags);
        }
    });

    generateIndex(tree, dict);

    Object.keys(dict).forEach(k => {
        let entry = dict[k];
        Object.keys(entry).forEach(v => {
            generatePage(tree, dict, k, v);
        });
    });

    console.timeEnd(colors.green(tree + ' written'));
}


function generateIndex(tree, dict) {
    let head = `
<meta charset='utf-8'>
<title>${tree}</title>
<link rel='stylesheet' href='../style.css'>`;

    let body = `
<h1>${tree}/</h1>
<div class="instructions"><span class="hi">👋</span>Hi! This project is called <a target="_blank" href="https://github.com/osmlab/name-suggestion-index/">name-suggestion-index</a>.<br/>
<br/>
We've collected a list of common business names from <a target="_blank" href="https://www.openstreetmap.org">OpenStreetMap</a>,
and we're matching them all to their preferred tags, including a <code>'brand:wikidata'</code> tag.<br/>
<br/>
This tag is pretty special because we can use it to link features in OpenStreetMap to records in
<a target="_blank" href="https://www.wikidata.org">Wikidata</a>, a free and open knowledge database.
<br/>
You can help us by adding brands to the index, matching brands to Wikidata identifiers, or by improving the brands' Wikidata pages.<br/>
<br/>
See <a target="_blank" href="https://github.com/osmlab/name-suggestion-index/blob/master/CONTRIBUTING.md">CONTRIBUTING.md</a> for more info.<br/>
</div>

<div class="container">`;

    Object.keys(dict).forEach(k => {
        let entry = dict[k];
        Object.keys(entry).forEach(v => {
            let href = `${k}/${v}.html`;
            let count = Object.keys(dict[k][v]).length;
            body += `
<div class="child"><a href="${href}">${k}/${v} (${count})</a></div>`;
        });
    });

    body += `
</div>`;

    writeHTML(`./docs/${tree}/index.html`, head, body);
}


function generatePage(tree, dict, k, v) {
    let head = `
<meta charset='utf-8'>
<title>${k}/${v}</title>
<link rel='stylesheet' href='../../style.css'>`;

    let body = `
<h2>${tree}/${k}/${v}</h2>
<a class="nav" href="../index.html">↑ Back to top</a>
<div class="instructions">Some things you can do here:
<ul>
<li>Is a brand name missing? <a target="_blank" href="https://github.com/osmlab/name-suggestion-index/issues">Open an issue</a> or pull request to add it!</li>
<li>Click the "View on Overpass Turbo" link to see where the name is used in OpenStreetMap.</li>
<li>If a record is missing a <code>'brand:wikidata'</code> tag, you can do the research to add it to our project, or filter it out if it is not a brand.<br/>
See <a target="_blank" href="https://github.com/osmlab/name-suggestion-index/blob/master/CONTRIBUTING.md">CONTRIBUTING.md</a> for more info.</li>
<li>If a record with a <code>'brand:wikidata'</code> tag has a poor description or is missing logos, click the Wikidata link and edit the Wikidata page.<br/>
You can add the brand's Facebook, Instagram, or Twitter usernames, and this project will pick up the logos later.</li>
</ul>
</div>

<table class="summary">
<thead>
<tr>
<th>Name / ID</th>
<th>Count</th>
<th>OpenStreetMap Tags</th>
<th>Wikidata ID</th>
<th>Wikidata Description</th>
<th class="logo">Wikidata Logo</th>
<th class="logo">Facebook Logo</th>
<th class="logo">Twitter Logo</th>
</tr>
<thead>
<tbody>`;

    Object.keys(dict[k][v]).forEach(name => {
        let entry = dict[k][v][name];
        let count = entry.count || '< 50';
        let tags = entry.tags || {};
        let label = entry.wdLabel || '';
        let description = entry.wdDescription || '';
        if (description) { description = `"${description}"`; }
        let logos = entry.logos || {};
        let slug = slugify(name);

        body += `
<tr>
<td><h3 class="slug" id="${slug}"><a href="#${slug}"/>#</a><span class="anchor">${tags.name}</span></h3>
  <div class="nsikey"><pre>'${name}'</pre></div>
  <div class="viewlink">` + overpass(k, v, tags.name) + `</div>
</td>
<td>${count}</td>
<td class="tags"><pre class="tags">` + displayTags(tags) + `</pre></td>
<td>` + wd(tags['brand:wikidata']) + `</td>
<td><h3>${label}</h3><span>${description}</span></td>
<td class="logo">` + logo(logos.wikidata) + `</td>
<td class="logo">` + logo(logos.facebook) + `</td>
<td class="logo">` + logo(logos.twitter) + `</td>
</tr>`;
    });

    body += `
</tbody>
</table>
</div>`;

    writeHTML(`./docs/${tree}/${k}/${v}.html`, head, body);
}


function overpass(k, v, name) {
    let q = encodeURI(`[out:json][timeout:25];
(nwr["${k}"="${v}"]["name"="${name}"];);
out body;
>;
out skel qt;`);
    let href = `https://overpass-turbo.eu/?Q=${q}&R`;
    return `<a target="_blank" href="${href}"/>View on Overpass Turbo</a>`;
}

function logo(src) {
    return src ? `<img class="logo" src="${src}"/>` : '';
}

function wd(qid) {
    return qid ? `<a target="_blank" href="https://www.wikidata.org/wiki/${qid}">${qid}</a>` : '';
}

function displayTags(tags) {
    let result = '';
    Object.keys(tags).forEach(k => {
        result += `
"${k}": "${tags[k]}"`;
    });
    return result;
}

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '');            // Trim - from end of text
}


function writeHTML(file, head, body) {
    let contents = `<!DOCTYPE html>
<html>
<head>
${head}
</head>
<body>
${body}
<a href="https://github.com/osmlab/name-suggestion-index/" class="github-corner" aria-label="View on GitHub"><svg width="80" height="80" viewBox="0 0 250 250" style="fill:#151513; color:#fff; position: absolute; top: 0; border: 0; right: 0;" aria-hidden="true"><path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path><path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" style="transform-origin: 130px 106px;" class="octo-arm"></path><path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" class="octo-body"></path></svg></a><style>.github-corner:hover .octo-arm{animation:octocat-wave 560ms ease-in-out}@keyframes octocat-wave{0%,100%{transform:rotate(0)}20%,60%{transform:rotate(-25deg)}40%,80%{transform:rotate(10deg)}}@media (max-width:500px){.github-corner:hover .octo-arm{animation:none}.github-corner .octo-arm{animation:octocat-wave 560ms ease-in-out}}</style>
</body>
</html>`;

    try {
        fs.ensureFileSync(file);
        fs.writeFileSync(file, contents);
    } catch (err) {
        console.error(colors.red('Error - ' + err.message + ' writing:'));
        console.error('  ' + colors.yellow(file));
        process.exit(1);
    }
}

