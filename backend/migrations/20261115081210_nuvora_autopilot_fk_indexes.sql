create index if not exists nuvora_ai_operations_created_by_idx
  on public.nuvora_ai_operations (created_by);
create index if not exists nuvora_ai_operations_reviewed_by_idx
  on public.nuvora_ai_operations (reviewed_by);
