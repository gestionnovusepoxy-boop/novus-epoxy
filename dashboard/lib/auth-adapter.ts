import type { Adapter, AdapterUser } from 'next-auth/adapters';
import { query } from './db';

function toUser(row: Record<string, unknown>): AdapterUser {
  return {
    id:            row.id as string,
    name:          (row.name as string) ?? null,
    email:         row.email as string,
    emailVerified: row.email_verified ? new Date(row.email_verified as string) : null,
    image:         (row.image as string) ?? null,
  };
}

export function NeonAdapter(): Adapter {
  return {
    async createUser(data) {
      const rows = await query(
        'INSERT INTO auth_users (name, email, email_verified, image) VALUES ($1, $2, $3, $4) RETURNING *',
        [data.name ?? null, data.email, data.emailVerified ?? null, data.image ?? null],
      );
      return toUser(rows[0]);
    },

    async getUser(id) {
      const rows = await query('SELECT * FROM auth_users WHERE id = $1', [id]);
      return rows[0] ? toUser(rows[0]) : null;
    },

    async getUserByEmail(email) {
      const rows = await query('SELECT * FROM auth_users WHERE email = $1', [email]);
      return rows[0] ? toUser(rows[0]) : null;
    },

    async getUserByAccount() {
      return null;
    },

    async updateUser(data) {
      const rows = await query(
        'UPDATE auth_users SET name = COALESCE($1, name), email = COALESCE($2, email), email_verified = COALESCE($3, email_verified), image = COALESCE($4, image) WHERE id = $5 RETURNING *',
        [data.name ?? null, data.email ?? null, data.emailVerified ?? null, data.image ?? null, data.id],
      );
      return toUser(rows[0]);
    },

    async createVerificationToken(data) {
      const rows = await query(
        'INSERT INTO auth_verification_tokens (identifier, token, expires) VALUES ($1, $2, $3) RETURNING *',
        [data.identifier, data.token, data.expires],
      );
      return {
        identifier: rows[0].identifier as string,
        token:      rows[0].token as string,
        expires:    new Date(rows[0].expires as string),
      };
    },

    async useVerificationToken({ identifier, token }) {
      const rows = await query(
        'DELETE FROM auth_verification_tokens WHERE identifier = $1 AND token = $2 RETURNING *',
        [identifier, token],
      );
      if (!rows[0]) return null;
      return {
        identifier: rows[0].identifier as string,
        token:      rows[0].token as string,
        expires:    new Date(rows[0].expires as string),
      };
    },

    async deleteUser(id) {
      await query('DELETE FROM auth_users WHERE id = $1', [id]);
    },

    async linkAccount() { return undefined; },
    async unlinkAccount() { return undefined; },
    async createSession() { return null as never; },
    async getSessionAndUser() { return null; },
    async updateSession() { return null; },
    async deleteSession() { return undefined; },
  };
}
