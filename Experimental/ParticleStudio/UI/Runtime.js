// Particle Studio UI · refresh runtime. Components register refreshers; Broadcast() re-reads every bound value.
// Scopes let a page (outliner, inspector) drop all of its refreshers when it rebuilds.
const Refreshers = new Set();
const ScopeStack = [];

export function OpenScope() { const Scope = new Set(); ScopeStack.push(Scope); return Scope; }
export function CloseScope(Scope) { const Top = ScopeStack.pop(); if (Top !== Scope && Scope) ScopeStack.splice(ScopeStack.indexOf(Scope), 1); }
export function ReleaseScope(Scope) { if (!Scope) return; for (const R of Scope) Refreshers.delete(R); Scope.clear(); }
export function Register(Refresher) { Refreshers.add(Refresher); if (ScopeStack.length) ScopeStack[ScopeStack.length - 1].add(Refresher); }
export function Broadcast() { for (const Refresher of Refreshers) Refresher(); }
