import { describe, expect, it } from 'vitest'
import {
  agencyTenantId,
  normalizeAgencyMembershipInput,
  personalTenantId,
} from './tenant-authorization.js'

describe('tenant authorization model', () => {
  it('uses deterministic tenant identifiers', () => {
    expect(personalTenantId('user-1')).toBe('personal:user-1')
    expect(agencyTenantId('agency-1')).toBe('agency:agency-1')
  })

  it('requires an explicit agency affiliation mode', () => {
    expect(() => normalizeAgencyMembershipInput({ role: 'member' })).toThrow(
      'affiliation_mode must be exclusive or non_exclusive',
    )
  })

  it('maps the legacy agent membership role to member', () => {
    expect(normalizeAgencyMembershipInput({
      role: 'agent',
      affiliationMode: 'exclusive',
    })).toEqual({ role: 'member', affiliationMode: 'exclusive' })
  })

  it('requires guest memberships to be non-exclusive', () => {
    expect(() => normalizeAgencyMembershipInput({
      role: 'guest',
      affiliationMode: 'exclusive',
    })).toThrow('Guest memberships must be non_exclusive')
  })

  it('requires tenant admins to be exclusive members', () => {
    expect(() => normalizeAgencyMembershipInput({
      role: 'admin',
      affiliationMode: 'non_exclusive',
    })).toThrow('Admin memberships must be exclusive')
  })

  it('does not allow ownership to be granted through member invitation', () => {
    expect(() => normalizeAgencyMembershipInput({
      role: 'owner',
      affiliationMode: 'exclusive',
    })).toThrow('Agency membership role must be admin, member, or guest')
  })
})