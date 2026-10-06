import { HttpClient, HttpErrorResponse, HttpHeaders, HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';

/** Act code (e.g. BIRTH_CERTIFICATE); the list comes from the service (GET /api/document-types). */
export type DocumentType = string;
export type Operator = 'MTN' | 'MOOV' | 'CELTIIS';
export type RequestStatus = 'UNPAID' | 'PAYMENT_PENDING' | 'PAID';
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';

export interface DocumentTypeInfo {
  code: DocumentType;
  label: string;
  unitPrice: number;
  serviceFee: number;
  currency: string;
}

export interface DocumentRequest {
  id: string;
  documentType: DocumentType;
  documentLabel: string;
  copies: number;
  unitPrice: number;
  serviceFee: number;
  amountDue: number;
  currency: string;
  status: RequestStatus;
  createdAt: string;
}

export interface Payment {
  id: string;
  requestId: string;
  operator: Operator;
  phoneNumber: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  message: string;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Current user (simplified identification of the service: X-User-Id header). */
@Injectable({ providedIn: 'root' })
export class CurrentUser {
  private static readonly STORAGE_KEY = 'taxstamp.user';
  readonly id = signal(read(CurrentUser.STORAGE_KEY) ?? 'alice');

  switchTo(id: string): void {
    this.id.set(id);
    try {
      localStorage.setItem(CurrentUser.STORAGE_KEY, id);
    } catch {
      /* storage unavailable: no consequence */
    }
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export const currentUserInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) {
    return next(req);
  }
  const user = inject(CurrentUser).id();
  return next(req.clone({ setHeaders: { 'X-User-Id': user } }));
};

@Injectable({ providedIn: 'root' })
export class TaxStampApi {
  private readonly http = inject(HttpClient);

  documentTypes(): Observable<DocumentTypeInfo[]> {
    return this.http.get<DocumentTypeInfo[]>('/api/document-types');
  }

  createRequest(documentType: DocumentType, copies: number): Observable<DocumentRequest> {
    // No amount sent: the service computes it.
    return this.http.post<DocumentRequest>('/api/document-requests', { documentType, copies });
  }

  requests(): Observable<DocumentRequest[]> {
    return this.http.get<DocumentRequest[]>('/api/document-requests');
  }

  request(id: string): Observable<DocumentRequest> {
    return this.http.get<DocumentRequest>(`/api/document-requests/${id}`);
  }

  pay(requestId: string, phoneNumber: string, operator: Operator, idempotencyKey: string): Observable<Payment> {
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });
    return this.http.post<Payment>(`/api/document-requests/${requestId}/payments`, { phoneNumber, operator }, { headers });
  }

  payments(requestId: string): Observable<Payment[]> {
    return this.http.get<Payment[]>(`/api/document-requests/${requestId}/payments`);
  }

  payment(id: string): Observable<Payment> {
    return this.http.get<Payment>(`/api/payments/${id}`);
  }
}

/** User-readable message (French) from an error response (service ProblemDetail). */
export function errorMessage(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) {
      return 'Service injoignable. Vérifiez votre connexion.';
    }
    const body = e.error as { detail?: string; fields?: Record<string, string> } | null;
    if (body?.fields) {
      return Object.entries(body.fields).map(([field, msg]) => `${field} : ${msg}`).join(', ');
    }
    if (body?.detail) {
      return body.detail;
    }
    return `Erreur ${e.status}`;
  }
  return 'Erreur inattendue';
}
