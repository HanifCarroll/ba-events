-- Wider Instagram watchlist. The 2026-11-14 posting-frequency scan picked about 160 cultural sources,
-- estimated at about $0.53 a day on Apify Starter with detailedData, so the 100-source ceiling and $1 run limit no longer fit.
alter table public.intake_policy drop constraint intake_policy_max_sources_check;
alter table public.intake_policy add constraint intake_policy_max_sources_check check (max_sources between 1 and 500);
alter table public.intake_policy drop constraint intake_policy_run_cap_usd_check;
alter table public.intake_policy add constraint intake_policy_run_cap_usd_check check (run_cap_usd between 0.01 and 5);
-- The monthly cap is per calendar month. The Apify account's own $19 limit (Starter) blocks any overage on the plan.
update public.intake_policy set max_sources = 200, run_cap_usd = 1.5, monthly_cap_usd = 18 where id;
