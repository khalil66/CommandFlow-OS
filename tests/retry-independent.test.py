"""Step 315B: disposable local database only; two tests reproduce known security blockers, not safety passes."""
from pathlib import Path
import importlib.util,sys,concurrent.futures,json,unittest,uuid
spec=importlib.util.spec_from_file_location('retry_fixture_helpers',str(Path(__file__).with_name('retry-database.test.py')))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
class IndependentVerification(unittest.TestCase):
 def test_twenty_four_workers_claim_thirty_six_distinct_records(self):
  user,job=h.owner();ids=[]
  for _ in range(36):
   job=str(uuid.uuid4());h.sql(f"INSERT INTO job_listings VALUES('{job}','{user}');");ids.append(h.queue(user,job))
  def worker(_):return json.loads(h.value(h.sql(f"SELECT retry_claim('{user}',NULL,3,900);")))
  with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:rows=[row for batch in pool.map(worker,range(24)) for row in batch]
  self.assertEqual(len(rows),36);self.assertEqual(len({r['id'] for r in rows}),36);self.assertEqual({r['retry_attempts'] for r in rows},{1})
 def test_skip_locked_claim_does_not_wait_for_locked_row(self):
  import subprocess,time
  user,job=h.owner();first=h.queue(user,job);job=str(uuid.uuid4());h.sql(f"INSERT INTO job_listings VALUES('{job}','{user}');");second=h.queue(user,job)
  proc=subprocess.Popen(h.BASE+['-c',f"BEGIN; SELECT id FROM ai_retry_queue WHERE id='{first}' FOR UPDATE; SELECT pg_sleep(2); COMMIT;"],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  try:
   for _ in range(100):
    if h.value(h.sql("SELECT count(*) FROM pg_stat_activity WHERE wait_event='PgSleep';"))!='0':break
    time.sleep(.01)
   start=time.monotonic();rows=h.claim(user);elapsed=time.monotonic()-start
   self.assertEqual([r['id'] for r in rows],[second]);self.assertLess(elapsed,1)
  finally:
   proc.wait()
   if proc.stderr:proc.stderr.close()
 def test_concurrent_reservations_mix_authenticated_and_service_role(self):
  user,job=h.owner()
  def req(i):return h.sql(f"SET ROLE {'authenticated' if i%2 else 'service_role'}; SELECT retry_reserve_usage('{user}','{job}');",user=user,role='authenticated' if i%2 else 'service_role',success=False).returncode==0
  with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:accepted=sum(pool.map(req,range(100)))
  self.assertEqual(accepted,25)
 def test_foreign_owner_cannot_claim_finish_or_unlock(self):
  user,job=h.owner();other,otherjob=h.owner();qid=h.queue(user,job);r=h.claim(user)[0]
  self.assertNotEqual(h.sql(f"SET ROLE authenticated; SELECT retry_claim('{user}',NULL,1,900);",user=other,role='authenticated',success=False).returncode,0)
  self.assertNotEqual(h.sql(f"SET ROLE authenticated; SELECT retry_finish('{user}','{qid}','{r['lease_token']}','{{\"success\":false,\"status\":\"queued\"}}');",user=other,role='authenticated',success=False).returncode,0)
  self.assertNotEqual(h.sql(f"SET ROLE service_role; SELECT retry_reserve_usage('{other}','{job}');",role='service_role',success=False).returncode,0)
 def test_authenticated_cannot_update_controls(self):
  user,job=h.owner()
  self.assertNotEqual(h.sql(f"SET ROLE authenticated; UPDATE retry_controls SET enabled=true WHERE user_id='{user}';",user=user,role='authenticated',success=False).returncode,0)
 def test_owner_can_forge_failed_usage_into_success_evidence(self):
  user,job=h.owner();r=h.value(h.sql(f"SELECT retry_reserve_usage('{user}','{job}');"))
  self.assertEqual(h.value(h.sql(f"SET ROLE authenticated; SELECT retry_finish_usage('{user}','{r}','{{\"success\":true,\"model\":\"fake\"}}');",user=user,role='authenticated')),'t')
  self.assertEqual(h.value(h.sql(f"SELECT count(*) FROM openai_usage WHERE user_id='{user}' AND success;")),'2')
  print('SECURITY BLOCKER reproduced: authenticated caller can certify provider success without artifacts.')
 def test_current_owner_usage_delete_policy_can_erase_limit_evidence(self):
  user,job=h.owner();h.sql('ALTER TABLE openai_usage ENABLE ROW LEVEL SECURITY; GRANT SELECT,INSERT,UPDATE,DELETE ON openai_usage TO authenticated; DROP POLICY IF EXISTS independent_owner_usage ON openai_usage; CREATE POLICY independent_owner_usage ON openai_usage FOR ALL TO authenticated USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);')
  h.sql(f"INSERT INTO openai_usage(user_id,kind,success) SELECT '{user}','resume',true FROM generate_series(1,25);")
  self.assertNotEqual(h.sql(f"SELECT retry_reserve_usage('{user}','{job}');",success=False).returncode,0)
  h.sql(f"SET ROLE authenticated; DELETE FROM openai_usage WHERE user_id='{user}';",user=user,role='authenticated')
  self.assertEqual(h.sql(f"SELECT retry_reserve_usage('{user}','{job}');").returncode,0)
  print('SECURITY BLOCKER reproduced: current owner DELETE privileges allow erasing 25/day usage evidence.')
if __name__=='__main__':unittest.main(verbosity=2)
