import { useEffect } from 'react'
import { beginDocumentJob } from './activity'
// Covers file reads and preparation outside the worker request itself.
export function useDocumentActivity(busy: boolean){useEffect(()=>busy?beginDocumentJob():undefined,[busy])}
