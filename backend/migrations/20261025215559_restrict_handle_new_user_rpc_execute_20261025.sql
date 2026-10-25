-- This SECURITY DEFINER trigger function is invoked by the auth.users trigger,
-- not intended as a callable client RPC.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
