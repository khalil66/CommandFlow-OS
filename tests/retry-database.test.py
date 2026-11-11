"""Run only against the disposable PostgreSQL server on /tmp/retry-pg:55439."""
import concurrent.futures
import json
import subprocess
import unittest
import uuid
from pathlib import Path

BASE = ['psql','-h','/tmp/retry-pg','-p','55439','-U','nobody','-d','postgres','-X','-A','-t','-v','ON_ERROR_STOP=1']
def sql(statement, user=None, role='service_role', success=True):
    identity=f"SET request.jwt.claim.role='{role}'; "
    if user: identity+=f"SET request.jwt.claim.sub='{user}'; "
    result=subprocess.run(BASE+['-c',identity+statement],capture_output=True,text=True)
    if success and result.returncode: raise AssertionError(result.stderr)
    return result

def value(result):
    return result.stdout.strip().splitlines()[-1]

def owner():
    user,job=str(uuid.uuid4()),str(uuid.uuid4())
    sql(f"INSERT INTO job_listings VALUES('{job}','{user}'); INSERT INTO retry_controls(user_id,enabled) VALUES('{user}',true);")
    return user,job

def queue(user,job,**overrides):
    row={'id':str(uuid.uuid4()),'user_id':user,'job_id':job,'next_retry_at':"now()-interval '1 minute'"}
    row.update(overrides)
    cols=','.join(row)
    vals=','.join(v if k=='next_retry_at' else f"'{v}'" for k,v in row.items())
    sql(f'INSERT INTO ai_retry_queue({cols}) VALUES({vals});')
    return row['id']

def claim(user, q=None):
    return json.loads(value(sql(f"SELECT retry_claim('{user}',{repr(q)+'::uuid' if q else 'NULL'},1,900);")))

class RetryDatabaseTests(unittest.TestCase):
    def test_concurrent_daily_limit_25_each(self):
        user,job=owner()
        def reserve(_):
            return sql(f"SELECT retry_reserve_usage('{user}','{job}');",success=False).returncode==0
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            self.assertEqual(sum(pool.map(reserve,range(35))),25)
        self.assertEqual(value(sql(f"SELECT count(*) FROM retry_usage_reservations WHERE user_id='{user}';")),'25')

    def test_prior_cover_usage_cannot_be_bypassed_by_service_role(self):
        user,job=owner()
        sql(f"INSERT INTO openai_usage(user_id,kind,success) SELECT '{user}','cover_letter',true FROM generate_series(1,25);")
        self.assertNotEqual(sql(f"SELECT retry_reserve_usage('{user}','{job}');",success=False).returncode,0)

    def test_prior_resume_limit_25(self):
        user,job=owner()
        sql(f"INSERT INTO openai_usage(user_id,kind,success) SELECT '{user}','resume',true FROM generate_series(1,25);")
        self.assertNotEqual(sql(f"SELECT retry_reserve_usage('{user}','{job}');",success=False).returncode,0)

    def test_foreign_owner_auth_and_rls(self):
        user,job=owner(); other=str(uuid.uuid4())
        self.assertNotEqual(sql(f"SELECT retry_reserve_usage('{user}','{job}');",user=other,role='authenticated',success=False).returncode,0)
        self.assertEqual(value(sql(f"SET ROLE authenticated; SELECT count(*) FROM retry_controls WHERE user_id='{user}';",user=other,role='authenticated')),'0')
        self.assertEqual(value(sql(f"SET ROLE authenticated; SELECT count(*) FROM retry_controls WHERE user_id='{user}';",user=user,role='authenticated')),'1')
        self.assertNotEqual(sql(f"SET ROLE anon; SELECT retry_claim('{user}',NULL,1,900);",role='anon',success=False).returncode,0)

    def test_concurrent_claims_never_duplicate(self):
        user,job=owner(); q=queue(user,job)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda _:claim(user),range(8)))
        self.assertEqual(sum(len(r) for r in results),1)
        self.assertEqual(value(sql(f"SELECT retry_attempts FROM ai_retry_queue WHERE id='{q}';")),'1')

    def test_due_only_max_attempts_and_pause(self):
        user,job=owner(); q=queue(user,job,next_retry_at="now()+interval '1 hour'")
        self.assertEqual(claim(user),[])
        sql(f"UPDATE ai_retry_queue SET next_retry_at=now(),retry_attempts=5 WHERE id='{q}';")
        self.assertEqual(claim(user),[])
        sql(f"UPDATE ai_retry_queue SET retry_attempts=0 WHERE id='{q}'; UPDATE retry_controls SET paused=true WHERE user_id='{user}';")
        self.assertEqual(claim(user),[])

    def test_fencing_and_missing_interview_prep(self):
        user,job=owner(); q=queue(user,job); row=claim(user)[0]
        payload=json.dumps({'success':True,'status':'completed','code':'success'})
        self.assertEqual(value(sql(f"SELECT retry_finish('{user}','{q}','{uuid.uuid4()}','{payload}');")),'f')
        self.assertNotEqual(sql(f"SELECT retry_finish('{user}','{q}','{row['lease_token']}','{payload}');",success=False).returncode,0)
        ids=[str(uuid.uuid4()) for _ in range(4)]
        sql(f"INSERT INTO resume_versions VALUES('{ids[0]}','{user}','{job}','Saved summary',ARRAY['Real bullet']); INSERT INTO cover_letters VALUES('{ids[1]}','{user}','{job}','Saved cover'); INSERT INTO applications VALUES('{ids[2]}','{user}','{job}','manual_review','{ids[0]}','{ids[1]}');")
        self.assertNotEqual(sql(f"SELECT retry_finish('{user}','{q}','{row['lease_token']}','{payload}');",success=False).returncode,0)
        sql(f"INSERT INTO interview_prep VALUES('{ids[3]}','{user}','{job}','{ids[2]}','{{\"why_company\":\"verified\"}}');")
        self.assertEqual(value(sql(f"SELECT retry_finish('{user}','{q}','{row['lease_token']}','{payload}');")),'t')
        self.assertEqual(value(sql(f"SELECT status FROM applications WHERE id='{ids[2]}';")),'manual_review')
        self.assertEqual(claim(user),[])

    def test_quota_pause_and_explicit_resume(self):
        user,job=owner(); q=queue(user,job); row=claim(user)[0]
        payload=json.dumps({'success':False,'status':'quota_limited','code':'quota_exhausted','pause':True,'next_retry_at':'2099-01-01T00:00:00Z'})
        self.assertEqual(value(sql(f"SELECT retry_finish('{user}','{q}','{row['lease_token']}','{payload}');")),'t')
        self.assertEqual(claim(user),[])
        sql(f"SELECT retry_resume('{user}');")
        self.assertEqual(len(claim(user)),1)

    def test_abandoned_lease_is_paused_not_replayed(self):
        user,job=owner(); q=queue(user,job); claim(user)
        sql(f"UPDATE ai_retry_queue SET lease_expires_at=now()-interval '1 second' WHERE id='{q}'; SELECT retry_recover_leases('{user}');")
        self.assertEqual(value(sql(f"SELECT status FROM ai_retry_queue WHERE id='{q}';")),'paused')
        self.assertEqual(claim(user),[])

    def test_usage_finish_idempotent_logs_and_costs(self):
        user,job=owner(); reservation=value(sql(f"SELECT retry_reserve_usage('{user}','{job}');"))
        payload=json.dumps({'success':True,'model':'gpt-4o-mini','prompt_tokens':100,'completion_tokens':50,'estimated_cost_cents':2})
        for _ in range(2): sql(f"SELECT retry_finish_usage('{user}','{reservation}','{payload}');")
        self.assertEqual(value(sql(f"SELECT count(*) FROM openai_usage WHERE user_id='{user}';")),'2')
        self.assertEqual(float(value(sql(f"SELECT sum(estimated_cost_cents) FROM openai_usage WHERE user_id='{user}';"))),2)

    def test_packet_single_flight_and_expired_lock_not_stolen(self):
        user,job=owner(); token=str(uuid.uuid4())
        self.assertEqual(value(sql(f"SELECT retry_packet_lock('{user}','{job}','{token}');")),'t')
        self.assertEqual(value(sql(f"SELECT retry_packet_lock('{user}','{job}','{uuid.uuid4()}');")),'f')
        sql(f"UPDATE retry_packet_leases SET expires_at=now()-interval '1 minute' WHERE user_id='{user}';")
        self.assertEqual(value(sql(f"SELECT retry_packet_lock('{user}','{job}','{uuid.uuid4()}');")),'f')

if __name__=='__main__': unittest.main(verbosity=2)
