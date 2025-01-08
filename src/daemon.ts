import type { At } from '@atcute/client/lexicons';
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { getSha256, ShortId, type KittyAgent } from 'kitty-agent';

export async function start({ agent, pds, did }: { agent: KittyAgent, pds: string, did: At.DID }) {
    const app = new Hono();

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

        return c.text(`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(uploadedBlob.ref.$link)}`);
        // return c.text(`https://wsrv.nl/?url=${`${pds}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(uploadedBlob.ref.$link)}`}`);
    });

    serve({
        fetch: app.fetch,
        port: 16912,
    });
}