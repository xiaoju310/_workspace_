"""No real voice requests or paid model calls: verify motion and voice contract."""
import json
import subprocess
import wave
from pathlib import Path
import pytest
from test_reading_workflow import setup, video_setup, url
from app import db
from app.services import animation_prompt, narration, video_runtime


def test_motion_prompt_keeps_reviewed_events_and_rejects_slideshow():
    shot = animation_prompt.shot_prompt('森林小路', ['乌龟向前走'])
    prompt = animation_prompt.video_prompt('乌龟：绿色背甲', shot)
    assert '乌龟向前走' in prompt and '绿色背甲' in prompt
    assert '持续' in prompt and '肢体关节变化' in prompt
    assert '不要用推拉摇移代替角色动画' in prompt
    assert '不新增人物、事件或文字' in prompt
    assert len(animation_prompt.video_prompt('角'*2000, '动'*2000)) <= 6000
    assert animation_prompt.video_prompt('角'*2000, '动'*2000).endswith(animation_prompt.MOTION)


def test_new_narration_requires_explicit_online_consent(setup):
    client, run, provider = video_setup(setup)
    result = client.post(url(run, '/video'), json={'confirm_paid':True,'narration':True})
    assert result.status_code == 422 and '在线' in result.json()['detail']
    assert not provider.posts


def test_new_video_freezes_motion_version_and_sends_motion_instructions(setup):
    client, run, provider = video_setup(setup)
    client.post(url(run, '/video'), json={'confirm_paid':True})
    assert len(provider.posts) == 2
    assert all('肢体关节变化' in p['content'][0]['text'] for p in provider.posts)
    with db.get_connection() as c:
        request = json.loads(c.execute("SELECT request_json FROM workflow_tasks WHERE run_id=? AND stage='book_video'", (run,)).fetchone()[0])
    assert request['motion_prompt_version'] == 3


def test_neural_voice_has_slow_female_voice_and_produces_pcm(monkeypatch, tmp_path):
    monkeypatch.setattr(narration, 'capabilities', lambda: {'narration_available':True})
    monkeypatch.setattr(video_runtime, 'ffmpeg_path', lambda:'fixture-ffmpeg')
    commands=[]
    def invoke(command, **kwargs):
        commands.append(command)
        if '--write-media' in command:
            text = Path(command[command.index('--file')+1]).read_text(encoding='utf-8')
            assert text == '小乌龟，慢慢地向前走。'
            Path(command[command.index('--write-media')+1]).write_bytes(b'mp3')
        else:
            with wave.open(command[-1], 'wb') as audio:
                audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(24000)
                audio.writeframes(b'\0' * 48000)
        return subprocess.CompletedProcess(command, 0, b'', b'')
    monkeypatch.setattr(narration.subprocess, 'run', invoke)
    assert narration.synthesize('小乌龟，慢慢地向前走。', tmp_path/'out.wav') == 1
    assert '--rate=-12%' in commands[0] and '--pitch=-2Hz' in commands[0]
    assert narration.VOICE in commands[0] and '-I' in commands[0]
    assert 'pcm_s16le' in commands[1]


def test_online_voice_failure_never_falls_back_to_windows(monkeypatch, tmp_path):
    monkeypatch.setattr(narration, 'capabilities', lambda: {'narration_available':True})
    monkeypatch.setattr(narration.subprocess, 'run', lambda *a, **kw: subprocess.CompletedProcess([], 1, b'', b''))
    calls=[]
    monkeypatch.setattr(narration.local_speech, 'synthesize', lambda *a: calls.append(a))
    with pytest.raises(narration.SpeechError, match='不会改用机械音'):
        narration.synthesize('故事开始了。',tmp_path/'out.wav')
    assert not calls and not (tmp_path/'out.wav').exists()


def test_legacy_task_voice_still_uses_original_snapshot(monkeypatch, tmp_path):
    calls=[]
    monkeypatch.setattr(narration.local_speech, 'synthesize', lambda *a: calls.append(a) or 1)
    assert narration.synthesize('旧故事',tmp_path/'old.wav','old-voice',provider='windows_system_speech') == 1
    assert calls[0][2] == 'old-voice'


def test_long_narration_stretches_whole_motion_not_frozen_tail(monkeypatch, tmp_path):
    from app.ai import compose
    audio=tmp_path/'speech.wav'
    with wave.open(str(audio), 'wb') as stream:
        stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(1000)
        stream.writeframes(b'\0'*20000)  # 10 seconds against 5 seconds of video
    output=tmp_path/'book.mp4'
    commands=[]
    monkeypatch.setattr(video_runtime, 'ffmpeg_path',lambda:'fixture-ffmpeg')
    monkeypatch.setattr(video_runtime, 'duration_ms',lambda p:5000 if p.name=='page.mp4' else 10250)
    def invoke(command,**kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(command,0,b'',b'')
    monkeypatch.setattr(video_runtime.subprocess,'run',invoke)
    monkeypatch.setattr(compose,'concatenate_segments',lambda *a,**kw:{'status':'ok'})
    assert video_runtime.concatenate([tmp_path/'page.mp4'],output,[audio]) == [10250]
    filters=commands[0][commands[0].index('-vf')+1]
    assert 'setpts=2.05*(PTS-STARTPTS)' in filters
    assert 'stop_duration=0.05' in filters
    assert 'stop_duration=10' not in filters


def test_motion_instruction_is_not_duplicated_and_story_is_preserved():
    shot = animation_prompt.shot_prompt('森林小路', ['乌龟向前走', '小鸟停在树上'])
    prompt = animation_prompt.video_prompt('乌龟：绿色背甲', shot)
    assert prompt.count(animation_prompt.MOTION) == 1
    assert '乌龟向前走' in prompt and '小鸟停在树上' in prompt


def test_prompt_preserves_full_guide_and_action_without_mid_sentence_cut():
    guide = '外观' * 999 + '终'
    action = '事件' * 999 + '末'
    prompt = animation_prompt.video_prompt(guide, action)
    assert guide in prompt and action in prompt
    assert prompt.count(animation_prompt.MOTION) == 1
    with pytest.raises(animation_prompt.PromptReviewError):
        animation_prompt.video_prompt(guide + '超长', action)


def test_shot_never_silently_drops_last_event():
    events = ['开始' * 700, '最后向朋友道歉并拥抱']
    prompt = animation_prompt.shot_prompt('积木房间', events)
    assert all(event in prompt for event in events)
    assert animation_prompt.MOTION not in prompt
    with pytest.raises(animation_prompt.PromptReviewError):
        animation_prompt.shot_prompt('场景', ['剧情' * 1100])


def test_character_guide_keeps_common_appearance_not_other_page_story():
    from copy import deepcopy
    # Invented fixture: not an extract from an uploaded book.
    meanings = [
        {'entities': [{'name': '角色甲', 'description': '戴圆眼镜，穿白色外套，站在实验桌前整理工具。'}]},
        {'entities': [{'name': '角色甲', 'description': '戴圆眼镜，穿黑色外套，坐在长椅上哭泣。'},
                      {'name': '角色乙', 'description': '戴绿色帽子，被角色甲指责后辩解，随后跑出车间。'}]},
    ]
    before = deepcopy(meanings)
    guide, warnings = animation_prompt.character_guide(meanings)
    assert '角色甲：戴圆眼镜' in guide and '角色乙：戴绿色帽子' in guide
    assert all(word not in guide for word in ['白色外套', '黑色外套', '哭泣', '指责', '跑出', '实验桌'])
    assert warnings and meanings == before


def test_character_guide_overflow_fails_instead_of_cutting():
    meanings = [{'entities': [{'name': '角色'+str(n), 'description': '红色' * 100} for n in range(20)]}]
    with pytest.raises(animation_prompt.PromptReviewError):
        animation_prompt.character_guide(meanings)


def test_merged_shot_removes_only_exact_system_instructions():
    action = ('拥抱后道歉。' + animation_prompt.MOTION + '；接着表现：小狗跑向门口。' + animation_prompt.MOTION)
    prompt = animation_prompt.video_prompt('', action)
    assert prompt.count(animation_prompt.MOTION) == 1
    assert '拥抱后道歉' in prompt and '小狗跑向门口' in prompt


def test_v2_task_prompt_remains_byte_for_byte_compatible():
    action = '本页事件。' + animation_prompt.MOTION
    request = {'motion_prompt_version': 2, 'story': {'character_guide': '红'*1787}}
    expected = '跨页统一角色设定：' + '红'*1500 + '。已确认本页动作：本页事件。动画要求：' + animation_prompt.MOTION
    assert animation_prompt.frozen_video_prompt(request, {'prompt': action}) == expected


def test_local_suggestion_and_preview_are_private_readonly_and_exact(setup):
    client, run, provider = video_setup(setup)
    before = client.get(url(run)).json()
    suggestion = client.get(url(run, '/character-guide'))
    assert suggestion.status_code == 200
    assert suggestion.json()['character_guide'] == '乌龟：绿色背甲'
    preview = client.get(url(run, '/prompts/1')).json()
    assert preview['motion_prompt_version'] == 3 and not preview['frozen']
    assert '乌龟向前走' in preview['prompt']
    assert not provider.posts and client.get(url(run)).json() == before
    for suffix in ['/character-guide', '/prompts/1']:
        assert client.get(url(run, suffix), headers={'Authorization': 'Bearer other-secret'}).status_code == 404
    assert client.get(url(run, '/prompts/99')).status_code == 404
    client.post(url(run, '/video'), json={'confirm_paid': True})
    frozen = client.get(url(run, '/prompts/1')).json()
    assert frozen['frozen'] and frozen['prompt'] == provider.posts[0]['content'][0]['text'] == preview['prompt']
    assert len(provider.posts) == 2


def test_storyboard_overflow_returns_actionable_error_and_saves_nothing(setup):
    client, run, _, _, _ = setup
    assert client.post(url(run, '/vision'), json={'confirm_paid': True, 'page_nos': [1, 2]}).status_code == 202
    with db.get_connection() as c:
        row = c.execute('SELECT vision_json FROM reading_workflows WHERE run_id=?', (run,)).fetchone()
        meanings = json.loads(row[0]); meanings[0]['events'] = ['事件'*1100]
        c.execute('UPDATE reading_workflows SET vision_json=? WHERE run_id=?', (json.dumps(meanings), run))
    response = client.post(url(run, '/storyboard'))
    assert response.status_code == 422 and '未自动截断' in response.json()['detail']
    assert client.get(url(run)).json()['storyboard'] is None


def test_new_story_only_sends_current_shot_events_without_mutating_story(setup):
    client, run, provider = video_setup(setup)
    with db.get_connection() as c:
        row = c.execute('SELECT storyboard_json FROM reading_workflows WHERE run_id=?', (run,)).fetchone()
        story = json.loads(row[0])
        story['shots'][0]['prompt'] = '乌龟在森林散步'
        story['shots'][1]['prompt'] = '乌龟生日时和朋友拥抱'
        c.execute('UPDATE reading_workflows SET storyboard_json=? WHERE run_id=?', (json.dumps(story), run))
    assert client.post(url(run, '/video'), json={'confirm_paid': True}).status_code == 202
    assert '生日' not in provider.posts[0]['content'][0]['text']
    assert '乌龟生日时和朋友拥抱' in provider.posts[1]['content'][0]['text']
    with db.get_connection() as c:
        assert json.loads(c.execute('SELECT storyboard_json FROM reading_workflows WHERE run_id=?', (run,)).fetchone()[0]) == story


def test_character_guide_excludes_mixed_appearance_and_later_plot_clauses():
    meanings = [{'entities': [
        {'name': '花斑小狗', 'description': '浅黄底色带深棕斑块，戴红色项圈，尾巴扫到多米诺骨牌。'},
        {'name': '彩色多米诺骨牌', 'description': '红蓝配色，靠近小狗尾巴一端的骨牌已经开始向城堡方向倾倒。'},
        {'name': '生日时穿红色裙子的女孩', 'description': '穿红色裙子。'},
    ]}]
    guide, warnings = animation_prompt.character_guide(meanings)
    assert '红色项圈' in guide and '红蓝配色' in guide
    assert all(word not in guide for word in ['扫到', '倾倒', '生日时'])
    assert warnings


def test_merged_source_shot_keeps_both_page_events_and_source_mapping(setup):
    client, run, provider = video_setup(setup)
    state = client.get(url(run)).json()
    story = state['storyboard']
    story['shots'] = [{**story['shots'][0], 'source_page_nos': [1, 2],
        'prompt': '乌龟在森林散步；接着表现：乌龟生日时和朋友拥抱',
        'caption': '乌龟散步后和朋友一起过生日'}]
    assert client.put(url(run, '/storyboard'), json={
        'expected_revision': state['revision'], 'character_guide': story['character_guide'],
        'shots': story['shots']}).status_code == 200
    state = client.get(url(run)).json()
    assert client.post(url(run, '/storyboard/approve'), json={
        'expected_revision': state['revision'], 'coverage_confirmed': True}).status_code == 200
    preview = client.get(url(run, '/prompts/1')).json()
    monkeypatch = setup[4]
    def compose(paths, output):
        output.write_bytes(b'fixture-merged')
        return [2500]
    monkeypatch.setattr(video_runtime, 'concatenate', compose)
    assert client.post(url(run, '/video'), json={'confirm_paid': True}).status_code == 202
    assert len(provider.posts) == 1
    text = provider.posts[0]['content'][0]['text']
    assert '森林散步' in text and '生日时和朋友拥抱' in text
    assert text == preview['prompt']
    with db.get_connection() as c:
        request = json.loads(c.execute("SELECT request_json FROM workflow_tasks WHERE run_id=? AND stage='book_video'", (run,)).fetchone()[0])
    assert request['story']['shots'][0]['source_page_nos'] == [1, 2]
    assert next(t for t in client.get(url(run)).json()['tasks'] if t['stage']=='book_video')['status'] == 'SUCCEEDED'
