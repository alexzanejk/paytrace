-- Two-step login for the admin, enforced by the database, without any risk of locking the owner out.
--
-- Rule: once an admin has a VERIFIED authenticator (TOTP) factor, a password-only session (aal1) is no
-- longer enough to read or change anything. Until they enrol, nothing changes. So switching this on
-- cannot lock anyone out, and enrolling immediately makes a stolen password useless on its own.
--
-- Recovery if the authenticator is lost: delete the factor row from the Supabase SQL editor:
--   delete from auth.mfa_factors where user_id = '<the admin user id>';

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
     and (
       coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
       or not exists (
         select 1 from auth.mfa_factors f
         where f.user_id = auth.uid() and f.status = 'verified'
       )
     );
$$;
