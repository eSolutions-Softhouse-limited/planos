/**
 * Built-in demo document covering all 7 v1 block kinds so the SPA renders
 * standalone offline (no server, no injection). Used as the loader fallback.
 */
import { type PlanDocument } from './types';

export const DEMO_DOC: PlanDocument = {
  schemaVersion: 1,
  type: 'plan',
  id: 'demo-plan-001',
  title: 'planos — Demo Plan (all 7 v1 kinds)',
  meta: {
    branch: 'main',
    status: 'in-review',
    createdAt: '2026-05-16T00:00:00.000Z',
    revision: 1,
  },
  blocks: [
    {
      id: 'sec-overview',
      kind: 'section',
      title: 'Overview',
      level: 1,
    },
    {
      id: 'prose-intro',
      kind: 'prose',
      md: [
        'This demo exercises **every v1 block kind** so the editor renders',
        'standalone. It supports a *little* markdown: `inline code`, lists,',
        'and [links](https://example.com).',
        '',
        '- bullet one',
        '- bullet two',
        '',
        '> A blockquote for good measure.',
        '',
        '```',
        'const x = 1;',
        '```',
      ].join('\n'),
    },
    {
      id: 'obj-1',
      kind: 'objective',
      text: 'Ship a structured plan-review editor reviewers actually trust.',
      successCriteria: [
        'All 7 v1 kinds render with kind-appropriate UI',
        'Task edits, answers, and comments are captured locally',
        'Builds to one offline single-file HTML',
      ],
    },
    {
      id: 'task-render',
      kind: 'task',
      title: 'Render all block kinds',
      detail: 'One renderer component per kind, dependency-light.',
      status: 'doing',
      deps: [],
      acceptance: [
        'section/prose/objective/task/decision/risk/openQuestion all render',
        'task is editable inline',
      ],
      estimate: '1d',
    },
    {
      id: 'task-wire',
      kind: 'task',
      title: 'Wire callback surface for envelope emission',
      status: 'todo',
      deps: ['task-render'],
      acceptance: ['onApprove/onRevise expose structured state'],
    },
    {
      id: 'dec-md',
      kind: 'decision',
      question: 'How should prose markdown be rendered?',
      options: [
        {
          label: 'Tiny local renderer',
          pros: ['Zero deps', 'Stays single-file'],
          cons: ['Not full CommonMark'],
        },
        {
          label: 'Pull in a markdown library',
          pros: ['Full spec'],
          cons: ['New runtime dep', 'Bundle bloat'],
        },
      ],
      chosen: 'Tiny local renderer',
      rationale: 'US-016 requires dependency-light + single offline file.',
    },
    {
      id: 'risk-scope',
      kind: 'risk',
      description: 'Editor scope creep into envelope/serialization work.',
      likelihood: 'M',
      impact: 'M',
      mitigation: 'Keep envelope emission in US-017; expose only a callback prop.',
    },
    {
      id: 'oq-status-set',
      kind: 'openQuestion',
      question:
        'Should reviewers be able to set task status to "cut", or only the agent?',
    },
    {
      id: 'oq-answered',
      kind: 'openQuestion',
      question: 'Is an offline demo document required?',
      answer: 'Yes — this very document is it.',
    },
  ],
};
