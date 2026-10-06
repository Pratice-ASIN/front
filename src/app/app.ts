import { DatePipe, DecimalPipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';

import {
  CurrentUser,
  DocumentRequest,
  DocumentType,
  DocumentTypeInfo,
  Operator,
  Payment,
  TaxStampApi,
  errorMessage,
} from './api';

const POLL_INTERVAL_MS = 2000;
const NETWORK_ATTEMPTS = 3;

const REQUEST_STATUS_LABELS = { UNPAID: 'À payer', PAYMENT_PENDING: 'Paiement en cours', PAID: 'Payée' } as const;
const PAYMENT_STATUS_LABELS = { PENDING: 'En cours', SUCCEEDED: 'Réussi', FAILED: 'Échoué', EXPIRED: 'Expiré' } as const;

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly api = inject(TaxStampApi);
  protected readonly user = inject(CurrentUser);

  protected readonly operators: Operator[] = ['MTN', 'MOOV', 'CELTIIS'];

  // --- user
  protected readonly userInput = signal(this.user.id());

  // --- requests
  protected readonly documentTypes = signal<DocumentTypeInfo[]>([]);
  protected readonly requests = signal<DocumentRequest[]>([]);
  protected readonly selectedType = signal<DocumentType>('BIRTH_CERTIFICATE');
  protected readonly copies = signal(1);
  protected readonly creating = signal(false);
  protected readonly requestError = signal<string | null>(null);

  // --- selection and payment
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selected = computed(() => this.requests().find((r) => r.id === this.selectedId()) ?? null);
  protected readonly history = signal<Payment[]>([]);
  protected readonly tracked = signal<Payment | null>(null);
  protected readonly phoneNumber = signal('');
  protected readonly operator = signal<Operator>('MTN');
  protected readonly sending = signal(false);
  protected readonly paymentError = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  /** Convenience check only; the service enforces the rule. */
  protected readonly phoneNumberValid = computed(() => /^01\d{8}$/.test(this.phoneNumber().trim()));

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopTracking());
    this.api.documentTypes().subscribe({
      next: (types) => {
        this.documentTypes.set(types);
        if (types.length && !types.some((t) => t.code === this.selectedType())) {
          this.selectedType.set(types[0].code);
        }
      },
      error: (e) => this.requestError.set(errorMessage(e)),
    });
    this.loadRequests();
  }

  // ------------------------------------------------------------------ user

  protected switchUser(): void {
    const id = this.userInput().trim();
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(id)) {
      this.requestError.set('Identifiant usager : 3 à 64 caractères (lettres, chiffres, . _ -)');
      return;
    }
    this.user.switchTo(id);
    this.clearSelection();
    this.loadRequests();
  }

  // ------------------------------------------------------------------ requests

  protected loadRequests(): void {
    this.api.requests().subscribe({
      next: (list) => {
        this.requests.set(list);
        this.requestError.set(null);
      },
      error: (e) => this.requestError.set(errorMessage(e)),
    });
  }

  protected createRequest(): void {
    this.creating.set(true);
    this.requestError.set(null);
    this.api.createRequest(this.selectedType(), this.copies()).subscribe({
      next: (r) => {
        this.creating.set(false);
        this.requests.update((list) => [r, ...list]);
        this.select(r);
      },
      error: (e) => {
        this.creating.set(false);
        this.requestError.set(errorMessage(e));
      },
    });
  }

  protected select(r: DocumentRequest): void {
    this.stopTracking();
    this.selectedId.set(r.id);
    this.tracked.set(null);
    this.paymentError.set(null);
    this.notice.set(null);
    this.loadHistory(r.id, true);
  }

  protected clearSelection(): void {
    this.stopTracking();
    this.selectedId.set(null);
    this.history.set([]);
    this.tracked.set(null);
  }

  private loadHistory(requestId: string, resumeTracking: boolean): void {
    this.api.payments(requestId).subscribe({
      next: (list) => {
        this.history.set(list);
        const pending = list.find((p) => p.status === 'PENDING');
        if (resumeTracking && pending) {
          this.track(pending);
        }
      },
      error: (e) => this.paymentError.set(errorMessage(e)),
    });
  }

  private refreshRequest(requestId: string): void {
    this.api.request(requestId).subscribe((r) =>
      this.requests.update((list) => list.map((x) => (x.id === r.id ? r : x))),
    );
  }

  // ------------------------------------------------------------------ payment

  protected pay(): void {
    const request = this.selected();
    if (!request || this.sending() || !this.phoneNumberValid()) {
      return;
    }
    // One key per attempt: a resend (unstable network, double click) reuses the same
    // key, and the service then returns the same payment without a new debit.
    const key = newIdempotencyKey();
    this.sending.set(true);
    this.paymentError.set(null);
    this.notice.set(null);
    this.send(request.id, this.phoneNumber().trim(), this.operator(), key, 1);
  }

  private send(requestId: string, phoneNumber: string, operator: Operator, key: string, attempt: number): void {
    this.api.pay(requestId, phoneNumber, operator, key).subscribe({
      next: (p) => {
        this.sending.set(false);
        this.notice.set(attempt > 1 ? `Requête renvoyée ${attempt - 1} fois avec la même clé : un seul débit.` : null);
        this.track(p);
        this.refreshRequest(requestId);
      },
      error: (e: unknown) => {
        if (e instanceof HttpErrorResponse && e.status === 0 && attempt < NETWORK_ATTEMPTS) {
          this.notice.set(`Réseau instable, nouvel envoi (${attempt + 1}/${NETWORK_ATTEMPTS}) avec la même clé…`);
          setTimeout(() => this.send(requestId, phoneNumber, operator, key, attempt + 1), 1000);
          return;
        }
        this.sending.set(false);
        this.paymentError.set(errorMessage(e));
        // Payment already pending or succeeded: show it instead of starting another one.
        const existing = e instanceof HttpErrorResponse ? (e.error?.paymentId as string | undefined) : undefined;
        if (existing) {
          this.api.payment(existing).subscribe((p) => this.track(p));
        }
        this.refreshRequest(requestId);
      },
    });
  }

  private track(p: Payment): void {
    this.stopTracking();
    this.tracked.set(p);
    this.upsertHistory(p);
    if (p.status !== 'PENDING') {
      return;
    }
    this.pollTimer = setInterval(() => {
      this.api.payment(p.id).subscribe({
        next: (latest) => {
          this.tracked.set(latest);
          this.upsertHistory(latest);
          if (latest.status !== 'PENDING') {
            this.stopTracking();
            this.refreshRequest(latest.requestId);
          }
        },
        error: () => {
          /* transient error: try again on the next tick */
        },
      });
    }, POLL_INTERVAL_MS);
  }

  private upsertHistory(p: Payment): void {
    this.history.update((list) =>
      list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list],
    );
  }

  private stopTracking(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ------------------------------------------------------------------ display

  protected requestStatusLabel(r: DocumentRequest): string {
    return REQUEST_STATUS_LABELS[r.status];
  }

  protected paymentStatusLabel(p: Payment): string {
    return PAYMENT_STATUS_LABELS[p.status];
  }

  protected operatorLabel(o: Operator): string {
    return o === 'CELTIIS' ? 'Celtiis' : o;
  }

  protected inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected inputNumber(event: Event): number {
    const n = Number.parseInt(this.inputValue(event), 10);
    return Number.isNaN(n) ? 1 : n;
  }
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
