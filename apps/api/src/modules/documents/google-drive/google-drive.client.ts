import { Injectable } from '@nestjs/common';
import { env } from '../../../shared/config/env';

export interface DriveTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  md5Checksum?: string;
  modifiedTime: string;
  webViewLink?: string;
  headRevisionId?: string;
  trashed?: boolean;
}

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const FIELDS = 'id,name,mimeType,parents,md5Checksum,modifiedTime,webViewLink,headRevisionId,trashed';

/** Google Drive API v3 sobre fetch (solo lectura: Drive es repositorio documental, no base de datos). */
@Injectable()
export class GoogleDriveClient {
  authUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: env().GOOGLE_CLIENT_ID ?? '',
      redirect_uri: env().GOOGLE_REDIRECT_URI ?? '',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES.join(' '),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code: string): Promise<DriveTokens & { email: string }> {
    const tokens = await this.tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: env().GOOGLE_REDIRECT_URI ?? '' });
    const about = await this.get<{ user: { emailAddress: string } }>(tokens.access_token, '/about?fields=user');
    return { ...tokens, email: about.user.emailAddress };
  }

  async refresh(tokens: DriveTokens): Promise<DriveTokens> {
    if (tokens.expiry_date > Date.now() + 60_000) return tokens;
    const fresh = await this.tokenRequest({ refresh_token: tokens.refresh_token, grant_type: 'refresh_token' });
    return { ...fresh, refresh_token: fresh.refresh_token || tokens.refresh_token };
  }

  async startPageToken(accessToken: string): Promise<string> {
    return (await this.get<{ startPageToken: string }>(accessToken, '/changes/startPageToken')).startPageToken;
  }

  async listFolder(accessToken: string, folderId: string, pageToken?: string) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    return this.get<{ files: DriveFileMeta[]; nextPageToken?: string }>(
      accessToken,
      `/files?q=${q}&fields=nextPageToken,files(${FIELDS})&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`,
    );
  }

  async changes(accessToken: string, pageToken: string) {
    return this.get<{ changes: { fileId: string; removed?: boolean; file?: DriveFileMeta }[]; nextPageToken?: string; newStartPageToken?: string }>(
      accessToken,
      `/changes?pageToken=${pageToken}&fields=nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))&pageSize=500`,
    );
  }

  /** Google Docs/Sheets se exportan a texto/CSV; el resto se descarga tal cual. */
  async download(accessToken: string, file: DriveFileMeta): Promise<{ data: Buffer; mimeType: string }> {
    const exportAs: Record<string, string> = {
      'application/vnd.google-apps.document': 'text/plain',
      'application/vnd.google-apps.spreadsheet': 'text/csv',
      'application/vnd.google-apps.presentation': 'text/plain',
    };
    const target = exportAs[file.mimeType];
    const path = target ? `/files/${file.id}/export?mimeType=${encodeURIComponent(target)}` : `/files/${file.id}?alt=media`;
    const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Drive download ${file.id}: ${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: target ?? file.mimeType };
  }

  private async get<T>(accessToken: string, path: string): Promise<T> {
    const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new Error(`Drive ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  private async tokenRequest(body: Record<string, string>): Promise<DriveTokens> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env().GOOGLE_CLIENT_ID ?? '', client_secret: env().GOOGLE_CLIENT_SECRET ?? '', ...body }),
    });
    const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; error?: string };
    if (!res.ok) throw new Error(`OAuth Google: ${json.error}`);
    return { access_token: json.access_token, refresh_token: json.refresh_token ?? '', expiry_date: Date.now() + json.expires_in * 1000 };
  }
}
