-- Khet Saathi v0.7.1: private storage bucket for saved shed clips (video, frames, last result).
-- Safe to run more than once. Run in the Supabase SQL Editor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shed-clips', 'shed-clips', false, 52428800,
        array['video/mp4', 'video/quicktime', 'image/jpeg', 'application/json'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Verify (read-only): one row, public = false, 52428800 bytes (50 MB).
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'shed-clips';
