import type { At } from '@atcute/client/lexicons';
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { getSha256, ShortId, type KittyAgent } from 'kitty-agent';
import { encryptData } from './crypto.js';

export async function start({ agent, pds, did, encryptPassphrase }: { agent: KittyAgent, pds: string, did: At.DID, encryptPassphrase?: string }) {
    const app = new Hono();

    function getUrl(pds: string, did: At.DID, cid: string) {
        // return `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
        return `https://wsrv.nl/?url=${encodeURIComponent(
            `${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`
        )}`;
    }

    app.post('/upload', async (c) => {
        const blob = await c.req.blob();

        const uploadedBlob = await agent.uploadBlob(blob);

        const rkey = ShortId.now();

        await agent.put({
            collection: 'blue.zio.atfile.upload',
            repo: did,
            rkey,
            record: {
                $type: 'blue.zio.atfile.upload',
                blob: uploadedBlob,
                createdAt: new Date().toISOString(),
                file: {
                    mimeType: uploadedBlob.mimeType,
                    name: rkey,
                    modifiedAt: new Date().toISOString(),
                    size: uploadedBlob.size,
                },
                checksum: {
                    algo: 'sha-256',
                    hash: getSha256(uploadedBlob)
                },
                finger: {
                    $type: 'blue.zio.atfile.finger#machine',
                    app: 'atfile-upload-folder/1.0.0',
                }
            },
        });

        return c.text(getUrl(pds, did, uploadedBlob.ref.$link));
    });

    app.post('/upload/encrypted', async (c) => {
        const blob = await c.req.blob();

        let buf = new Uint8Array(await blob.arrayBuffer());
        buf = await encryptData(buf, encryptPassphrase!)

        const uploadedBlob = await agent.uploadBlob(new Blob([buf], { type: 'application/vnd.age' }));

        const rkey = ShortId.now();

        await agent.put({
            collection: 'blue.zio.atfile.upload',
            repo: did,
            rkey,
            record: {
                $type: 'blue.zio.atfile.upload',
                blob: uploadedBlob,
                createdAt: new Date().toISOString(),
                file: {
                    mimeType: 'application/vnd.age',
                    name: rkey,
                    modifiedAt: new Date().toISOString(),
                    size: uploadedBlob.size,
                },
                checksum: {
                    algo: 'sha-256',
                    hash: getSha256(uploadedBlob)
                },
                finger: {
                    $type: 'blue.zio.atfile.finger#machine',
                    app: 'atfile-upload-folder/1.0.0',
                }
            },
        });

        return c.text(getUrl(pds, did, uploadedBlob.ref.$link));
    });

    serve({
        fetch: app.fetch,
        port: 16912,
    }, info => console.log(info));
}