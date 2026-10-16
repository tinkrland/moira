// files-block adapters (spec 14). each adapter speaks one provider's read
// api behind one interface:
//
//   listFiles(creds, { folderId, pageSize }) -> { rows: [fileRow] }
//   readFile(creds, { fileId })               -> { content, meta }
//
// creds is whatever the owner sealed at authorize time (an oauth access
// token for drive/onedrive/dropbox; mega's session key when that adapter
// lands). adapters are io only - the hub does policy, passes, sealing and
// untrusted tagging. every row a provider returns is marked untrusted by
// the hub; adapters normalize shape only.
//
// live verification status (honest): drive, onedrive and dropbox adapters
// are implemented against their documented read apis and exercised in tests
// via injected fetch fixtures. they have NOT been run against the real
// endpoints - that needs the owner's oauth apps (client ids/secrets) and is
// a stated gap, not an assumed pass. mega's protocol (custom rpc with
// aes-encrypted payloads, no oauth) is its own project: its adapter answers
// not_implemented until then.

const DEFAULT_FETCH = (typeof globalThis.fetch === 'function')
  ? globalThis.fetch.bind(globalThis)
  : null;

function requireFetch(overrides) {
  const f = overrides?.fetch ?? DEFAULT_FETCH;
  if (typeof f !== 'function') throw new Error('no fetch available: pass { fetch } for tests or run on node 18+');
  return f;
}

async function expectOk(res, provider) {
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error(`${provider} request failed: http ${res.status} ${detail.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  return res;
}

// --- google drive (rest v3, readonly) ---------------------------------------

export const driveAdapter = {
  id: 'drive',
  provider: 'google_drive',
  async listFiles(creds, { folderId = 'root', pageSize = 50 } = {}, io) {
    const f = requireFetch(io);
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=${pageSize}` +
      `&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,size,parents)')}` +
      `&orderBy=modifiedTime desc`;
    const res = await expectOk(await f(url, { headers: { authorization: `Bearer ${creds.accessToken}` } }), 'drive');
    const body = await res.json();
    const rows = (body.files ?? []).map((file) => ({
      id: file.id, name: file.name, mimeType: file.mimeType,
      modifiedAt: file.modifiedTime ?? null, size: file.size ?? null
    }));
    return { rows };
  },
  async readFile(creds, { fileId } = {}, io) {
    const f = requireFetch(io);
    const res = await expectOk(
      await f(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: { authorization: `Bearer ${creds.accessToken}` } }),
      'drive');
    return { content: await res.text(), meta: { id: fileId } };
  }
};

// --- dropbox (content access api) --------------------------------------------

export const dropboxAdapter = {
  id: 'dropbox',
  provider: 'dropbox',
  async listFiles(creds, { folderId = '' } = {}, io) {
    const f = requireFetch(io);
    const res = await expectOk(await f('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: { authorization: `Bearer ${creds.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ path: folderId === 'root' ? '' : folderId, limit: 50 })
    }), 'dropbox');
    const body = await res.json();
    const rows = (body.entries ?? [])
      .filter((e) => e['.tag'] === 'file')
      .map((e) => ({
        id: e.id, name: e.name, mimeType: e.mime_type ?? null,
        modifiedAt: e.client_modified ?? null, size: e.size ?? null
      }));
    return { rows };
  },
  async readFile(creds, { fileId } = {}, io) {
    const f = requireFetch(io);
    const res = await expectOk(await f('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${creds.accessToken}`,
        'dropbox-api-arg': JSON.stringify({ path: fileId })
      }
    }), 'dropbox');
    return { content: await res.text(), meta: { id: fileId } };
  }
};

// --- onedrive (microsoft graph) ------------------------------------------------

export const onedriveAdapter = {
  id: 'onedrive',
  provider: 'onedrive',
  async listFiles(creds, { folderId = 'root', pageSize = 50 } = {}, io) {
    const f = requireFetch(io);
    const base = folderId === 'root'
      ? 'https://graph.microsoft.com/v1.0/me/drive/root/children'
      : `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}/children`;
    const res = await expectOk(await f(`${base}?$top=${pageSize}&select=id,name,fileSystemInfo,size,lastModifiedDateTime,parentReference`, {
      headers: { authorization: `Bearer ${creds.accessToken}` }
    }), 'onedrive');
    const body = await res.json();
    const rows = (body.value ?? []).map((item) => ({
      id: item.id, name: item.name,
      mimeType: null, // graph gives file/facets, not a mime string; keep shape stable
      modifiedAt: item.lastModifiedDateTime ?? null,
      size: item.size ?? null
    }));
    return { rows };
  },
  async readFile(creds, { fileId } = {}, io) {
    const f = requireFetch(io);
    const res = await expectOk(
      await f(`https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(fileId)}/content`,
        { headers: { authorization: `Bearer ${creds.accessToken}` } }),
      'onedrive');
    return { content: await res.text(), meta: { id: fileId } };
  }
};

// --- mega (custom rpc protocol; no oauth) --------------------------------------

export const megaAdapter = {
  id: 'mega',
  provider: 'mega',
  // mega's api is a custom rpc (seq-numbered commands over https with
  // aes-encrypted payloads) plus its own login handshake. the owner pastes
  // a session key at authorize time, but the fetch path needs the full
  // protocol client. until that lands, every call answers not_implemented
  // instead of pretending.
  async listFiles() {
    return { outcome: 'not_implemented', reason: 'mega adapter awaits its protocol client (custom rpc + aes payloads; no oauth)' };
  },
  async readFile() {
    return { outcome: 'not_implemented', reason: 'mega adapter awaits its protocol client (custom rpc + aes payloads; no oauth)' };
  }
};

// adapter lookup by registry 'adapter' field

export const FILE_ADAPTERS = {
  drive: driveAdapter,
  dropbox: dropboxAdapter,
  onedrive: onedriveAdapter,
  mega: megaAdapter
};

export function adapterFor(connectorId, overrides) {
  const defs = { google_drive: 'drive', dropbox: 'dropbox', onedrive: 'onedrive', mega: 'mega' };
  const name = defs[connectorId];
  const a = (overrides?.adapters ?? FILE_ADAPTERS)[name];
  if (!a) throw new Error(`no adapter registered for connector ${connectorId}`);
  return a;
}
