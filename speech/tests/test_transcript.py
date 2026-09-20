import asyncio
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).parents[1] / 'network_transcribe.py')
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class TranscriptTests(unittest.TestCase):
    def test_completed_speech_and_answers_append_even_after_api_failure(self):
        async def events():
            for text in ['My name is Sam.', 'What is my name?']:
                yield json.dumps({'type': 'Results', 'is_final': True, 'speech_final': True,
                                  'channel': {'alternatives': [{'transcript': text}]}})

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'conversation.jsonl'
            with patch.object(receiver, 'TRANSCRIPT_PATH', path), patch.object(
                receiver, 'submit_query', side_effect=[OSError('offline'), {'answer': 'Sam.'}]
            ):
                asyncio.run(receiver.receive_transcripts(events(), 'test-key'))
                path = next(Path(directory).glob('conversation-*.jsonl'))
                records = [json.loads(line) for line in path.read_text().splitlines()]
                self.assertEqual([r['role'] for r in records], ['user', 'user', 'assistant'])
                self.assertEqual(records[0]['text'], 'My name is Sam.')
                self.assertEqual(records[1]['exchange_id'], records[2]['exchange_id'])
                receiver.record_transcript('user', 'Another conversation', 'new')
                self.assertEqual(len(path.read_text().splitlines()), 4)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_daily_rollover_preserves_and_appends_previous_days(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory) / 'conversation.jsonl'
            base.write_text('legacy transcript\n')
            first = datetime(2026, 9, 19, 12, tzinfo=timezone.utc)
            second = datetime(2026, 9, 20, 12, tzinfo=timezone.utc)
            with patch.object(receiver, 'TRANSCRIPT_PATH', base), patch.object(receiver, 'datetime') as clock:
                for moment, text in [(first, 'first day'), (second, 'second day'), (first, 'appended')]:
                    clock.now.return_value = moment
                    receiver.record_transcript('user', text, 'test')
            first_file = base.with_name(f'conversation-{first.astimezone().date()}.jsonl')
            second_file = base.with_name(f'conversation-{second.astimezone().date()}.jsonl')
            self.assertEqual([json.loads(line)['text'] for line in first_file.read_text().splitlines()],
                             ['first day', 'appended'])
            self.assertEqual(json.loads(second_file.read_text())['text'], 'second day')
            self.assertEqual(base.read_text(), 'legacy transcript\n')


if __name__ == '__main__':
    unittest.main()
