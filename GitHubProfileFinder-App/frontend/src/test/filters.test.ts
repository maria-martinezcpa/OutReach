import { describe, expect, it } from 'vitest'
import { counted, emptyExtra, extraCount, extraMatches, textMatches } from '../filters'
import type { Profile } from '../types'

const person = {
  login: 'dana-dev', name: 'Dana Scully', company: '@acme', location: 'Dublin', country: 'Ireland', region: 'Northern Europe',
  continent: 'Europe', bio: 'I build BIM viewers', hireable: true, followers: 120, public_repos: 30, languages: ['Python', 'C#'],
  roles: [{ title: 'GIS Developer', source: 'bio' }],
  analysis: { skills: [{ name: 'PostGIS' }], human_confidence: 'HIGH', activity_status: 'ACTIVE' },
  contacts: { emails: [{ value: 'dana@example.com', source: 'x' }], phones: [], linkedin: { value: 'https://linkedin.com/in/dana', source: 'x' },
    website: 'https://dana.dev', links: [] },
} as unknown as Profile

describe('field search', () => {
  it('searches only the chosen field, or every field', () => {
    expect(textMatches(person, 'email', 'example.com')).toBe(true)
    expect(textMatches(person, 'name', 'example.com')).toBe(false)
    expect(textMatches(person, 'name', 'scully')).toBe(true)
    expect(textMatches(person, 'login', 'scully')).toBe(false)
    expect(textMatches(person, 'bio', 'bim')).toBe(true)
    expect(textMatches(person, 'skills', 'postgis')).toBe(true)
    expect(textMatches(person, 'languages', 'c#')).toBe(true)
    expect(textMatches(person, 'website', 'linkedin.com/in/dana')).toBe(true)
    expect(textMatches(person, 'location', 'northern')).toBe(true)
    for (const q of ['dana@', 'acme', 'dublin', 'bim viewers', 'python', 'dana.dev']) expect(textMatches(person, 'all', q)).toBe(true)
    expect(textMatches(person, 'all', 'nothing-like-this')).toBe(false)
    expect(textMatches(person, 'email', '')).toBe(true)
  })
})

describe('more filters', () => {
  it('matches country, language, confidence, activity, ranges and open to hire', () => {
    expect(extraMatches(person, emptyExtra)).toBe(true)
    expect(extraMatches(person, { ...emptyExtra, country: 'Ireland', language: 'C#', confidence: 'HIGH', activity: 'ACTIVE' })).toBe(true)
    expect(extraMatches(person, { ...emptyExtra, country: 'Germany' })).toBe(false)
    expect(extraMatches(person, { ...emptyExtra, language: 'Go' })).toBe(false)
    expect(extraMatches(person, { ...emptyExtra, confidence: 'LOW' })).toBe(false)
    expect(extraMatches(person, { ...emptyExtra, minFollowers: '100', maxFollowers: '120' })).toBe(true)
    expect(extraMatches(person, { ...emptyExtra, minFollowers: '121' })).toBe(false)
    expect(extraMatches(person, { ...emptyExtra, maxRepos: '29' })).toBe(false)
    expect(extraMatches(person, { ...emptyExtra, hireable: true })).toBe(true)
    expect(extraMatches({ ...person, hireable: null }, { ...emptyExtra, hireable: true })).toBe(false)
    expect(extraCount({ ...emptyExtra, country: 'Ireland', minRepos: '5', hireable: true })).toBe(3)
  })

  it('counts values, most common first', () => {
    expect(counted(['b', 'a', 'b', '', 'c', 'a', 'b'])).toEqual([{ value: 'b', count: 3 }, { value: 'a', count: 2 }, { value: 'c', count: 1 }])
  })
})
