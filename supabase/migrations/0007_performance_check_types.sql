-- Keep enum changes in their own migration before using the new values.
alter type public.check_type add value if not exists 'performance';
alter type public.job_name add value if not exists 'performance_check';
