import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '@/features/quickadd/parser';
import { at } from './helpers';

// Monday, 26 October 2026, 08:00
const NOW = at('2026-10-26', '08:00');
const parse = (text: string) => parseQuickAdd(text, NOW);

describe('quick-add parser', () => {
  it('parses "Finish report tomorrow at 10 AM"', () => {
    expect(parse('Finish report tomorrow at 10 AM')).toMatchObject({
      title: 'Finish report',
      dueDate: '2026-10-27',
      dueTime: '10:00',
      recurrence: 'none',
    });
  });

  it('parses "Call the client Friday at 3 PM"', () => {
    expect(parse('Call the client Friday at 3 PM')).toMatchObject({
      title: 'Call the client',
      dueDate: '2026-10-30',
      dueTime: '15:00',
    });
  });

  it('parses "Pay electricity bill every month on the 5th"', () => {
    expect(parse('Pay electricity bill every month on the 5th')).toMatchObject({
      title: 'Pay electricity bill',
      dueDate: '2026-11-05',
      recurrence: 'monthly',
    });
  });

  it('handles weekly, daily and weekday recurrences', () => {
    expect(parse('Team sync every Monday at 9:30am')).toMatchObject({
      title: 'Team sync',
      dueDate: '2026-10-26',
      dueTime: '09:30',
      recurrence: 'weekly',
    });
    expect(parse('Take vitamins daily')).toMatchObject({ title: 'Take vitamins', recurrence: 'daily', dueDate: '2026-10-26' });
  });

  it('handles relative and absolute dates', () => {
    expect(parse('Renew passport in 3 days').dueDate).toBe('2026-10-29');
    expect(parse('Check oven in 20 minutes')).toMatchObject({ title: 'Check oven', dueDate: '2026-10-26', dueTime: '08:20' });
    expect(parse('Dentist Nov 3 at 14:15')).toMatchObject({ title: 'Dentist', dueDate: '2026-11-03', dueTime: '14:15' });
    expect(parse('Birthday 2 January')).toMatchObject({ title: 'Birthday', dueDate: '2027-01-02' });
    expect(parse('Tax 2027-04-15').dueDate).toBe('2027-04-15');
    expect(parse('Lunch at noon')).toMatchObject({ title: 'Lunch', dueDate: '2026-10-26', dueTime: '12:00' });
    expect(parse('Next friday review').dueDate).toBe('2026-10-30');
  });

  it('uses tomorrow when a bare time has already passed today', () => {
    expect(parse('Wake up 7am')).toMatchObject({ title: 'Wake up', dueDate: '2026-10-27', dueTime: '07:00' });
  });

  it('extracts labels and priority', () => {
    expect(parse('Ship release #work #urgent !high')).toMatchObject({
      title: 'Ship release',
      labels: ['work', 'urgent'],
      priority: 'high',
    });
    expect(parse('Tidy desk p3').priority).toBe('low');
  });

  it('leaves ordinary text alone', () => {
    expect(parse('Buy sun cream and sat nav')).toMatchObject({ title: 'Buy sun cream and sat nav', dueDate: null, tokens: [] });
    expect(parse('Read chapter 5')).toMatchObject({ title: 'Read chapter 5', dueDate: null, dueTime: null });
    expect(parse('Email Mark about may report').dueDate).toBeNull();
  });

  it('lets the user switch off a detection', () => {
    const p = parseQuickAdd('Watch Friday Night Lights', NOW, { disabled: new Set(['date']) });
    expect(p).toMatchObject({ title: 'Watch Friday Night Lights', dueDate: null });
  });
});
