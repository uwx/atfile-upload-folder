import 'dotenv/config';
import { CredentialManager } from '@atcute/client';
import { filepathToRkey } from './rkey.js';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import Readline from 'node:readline/promises';
import { parseArgs } from "node:util";
import nodePath from 'path-browserify';
import { parse as parseMime } from 'file-type-mime';
import { lookupMime } from './mime.js';
import { create as createCid, toString as cidToString } from '@atcute/cid';
import { getDidAndPds, getSha256, KittyAgent } from 'kitty-agent';
import '@atcute/client/lexicons';
import { encryptData } from './crypto.js';

let { values: { username, password, dryRun, encryptPassphrase }, positionals: pos } = parseArgs({
  options: {
    username: {
      type: "string",
      short: "u",
    },
    password: {
      type: "string",
      short: "p",
    },
    dryRun: {
        type: 'boolean',
    },
    encryptPassphrase: {
        type: 'string',
    },
  },
  allowPositionals: true,
});

const rl = Readline.createInterface({ input: process.stdin, output: process.stdout });

username ??= process.env.BSKY_USERNAME ?? await rl.question('Bluesky Username > ');
password ??= process.env.BSKY_PASSWORD ?? await rl.question('Bluesky Password (or App Password) > ');

const { pds, did } = await getDidAndPds(username);
const session = new CredentialManager({ service: pds });
const agent = new KittyAgent({ handler: session });

await session.login({
    identifier: username,
    password
});

const [command, basePath] = pos;
if (command === 'upload') {
    if (!basePath) {
        throw new Error('Did not provide folder to upload!');
    }

    console.log(`Uploading ${basePath} to ${username}...`);

    const dir = await readdir(basePath, { recursive: true, withFileTypes: true });

    let answer = '';
    do {
        answer = (await rl.question(`Really upload ${dir.length} files? (Y/n) > `))
            .trim().toLowerCase();
    } while (answer !== 'y' && answer !== 'n');

    if (answer === 'y') {
        const { cids: blobs } = await agent.paginatedListBlobs({
            did: await agent.resolveHandle(username)
        });
        const allBlobs = new Set(blobs);

        for (const entry of dir) {
            if (entry.isDirectory()) continue;

            const realPath = join(entry.parentPath, entry.name);
            let path = realPath.replace(/\\/g, '/');
            path = nodePath.relative(basePath, path);

            const rkey = filepathToRkey(path);
            console.log(realPath, rkey, path);

            let file: Uint8Array = await readFile(realPath);

            if (encryptPassphrase) {
                file = await encryptData(file, encryptPassphrase)
            }

            const cidCompare = cidToString(await createCid(0x55, file));
            if (allBlobs.has(cidCompare)) {
                console.log('already uploaded!');
                continue;
            }

            if (!dryRun) {
                // TODO find existing CID and don't upload if unchanged
                const blob = await agent.uploadBlob(
                    new Blob([file], {
                        type: encryptPassphrase
                            ? 'application/vnd.age'
                            : (lookupMime(realPath) ?? parseMime(file.buffer as ArrayBuffer)?.mime)
                    })
                );

                await agent.put({
                    collection: 'blue.zio.atfile.upload',
                    repo: username,
                    rkey,
                    record: {
                        $type: 'blue.zio.atfile.upload',
                        blob: blob,
                        createdAt: new Date().toISOString(),
                        file: {
                            mimeType: encryptPassphrase ? 'application/vnd.age' : blob.mimeType,
                            name: `${path}.age`,
                            modifiedAt: (await stat(realPath)).mtime.toISOString(),
                            size: blob.size,
                        },
                        checksum: {
                            algo: 'sha-256',
                            hash: getSha256(blob)
                        },
                        finger: {
                            $type: 'blue.zio.atfile.finger#machine',
                            app: 'atfile-upload-folder/1.0.0',
                        }
                    },
                    // swapRecord: cid
                });
            }
        }
    }
} else if (command === 'daemon') {
    await (await import('./daemon.js')).start({ agent, pds, did });
} else {
    throw new Error('No command specified!');
}
