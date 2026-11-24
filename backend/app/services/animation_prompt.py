"""Motion directions stay grounded in reviewed page events, not invented story actions."""
import re


MOTION = ('生成真正的绘本角色动画，而不是静态图片、幻灯片或只移动镜头。'
          '角色从开头到结尾持续有自然、可见的身体动作，按已确认事件表现动作的起势、过程和收势；'
          '行走等动作要有肢体关节变化和相应位移，不是整张图片平移。'
          '原书未描述大动作时，仅表现自然呼吸、轻微眨眼等不改变情节的微动作。'
          '镜头稳定，以角色自身运动为主，不要用推拉摇移代替角色动画。'
          '保持原书人物身份、外观、服装、配色、场景和绘本画风，不新增人物、事件或文字。')



class PromptReviewError(ValueError):
    """Local review is required; the message contains no story or credentials."""


# Conservative local parsing, NOT a sensitive-word detector or a cloud moderation bypass.
# An uncertain clause stays in the page evidence, never in the shared identity guide.
_DYNAMIC = re.compile(
    r'正在|正(?=举|坐|站|抬|闭|捧|伸|手|推)|先|随后|之后|本页|未露面|出现在|'
    r'神情|表情|神态|面带|笑容|开怀|紧张|慌张|忧虑|思念|当事人|对象|'
    r'跪|坐|趴|蹲|站|抬|举|伸|撑|捧|咬|叼|哭|笑|惊呼|指责|辩解|'
    r'跑|飞奔|行走|打喷嚏|拥抱|道歉|祝福|迎接|收到|邀请|看向|看着|'
    r'搭建|拼搭|放置|倒塌|晃动|吐着|托脸|防止|抚摸|挥手|转身|递给|'
    r'已经|开始|接着|当时|此时|后来|最后|生日时|庆祝|扫到|扫过|倾倒|'
    r'撞|碰|摔|掉落|推倒|拉扯|追赶|扑向|跳起|冲向|离开|来到|走到')
_APPEARANCE = re.compile(
    r'发|辫|髻|头|毛|斑|纹|色|衣|裤|裙|鞋|袜|帽|饰|夹|箍|项圈|'
    r'背甲|翅膀|耳|眼|鼻|尾|壳|外套|背带|短袖|长袖|T恤')


def character_guide(meanings):
    """Keep only conservative appearance clauses shared by same-name observations.

    No alias/identity guessing. Conflicting or dynamic descriptions are left for
    manual review. All original observations and page events remain untouched.
    """
    observations = {}
    warnings = []
    for page in meanings:
        for entity in page['entities']:
            name = entity['name'].strip()
            if not name or _DYNAMIC.search(name):
                warnings.append('存在带动作或时间信息的实体名称，未加入固定外观；请对照原分析核对。')
                continue
            clauses = []
            for part in re.split(r'[，,。；;！!？?\n]', entity['description']):
                part = part.strip(' ：:')
                if part and _APPEARANCE.search(part) and not _DYNAMIC.search(part):
                    if part not in clauses:
                        clauses.append(part)
            observations.setdefault(name, []).append(clauses)
    entries = []
    for name, variants in observations.items():
        # Different poses/clothes are not silently merged into one invented person.
        common = [part for part in variants[0] if all(part in v for v in variants[1:])]
        if any(v != variants[0] for v in variants[1:]):
            warnings.append(name + '：跨页描述有差异，仅保留共同外观；请人工核对身份和服装。')
        if common:
            entries.append(name + '：' + '，'.join(common))
        else:
            warnings.append(name + '：未提取到可靠的共同外观，按对应原图复核，不自动猜测。')
    guide = '；'.join(entries)
    if len(guide) > 2000:
        raise PromptReviewError('角色外观设定超过编辑长度限制，请人工整理；未截断或保存不完整内容。')
    return guide, warnings


def shot_prompt(scene, events):
    # All grounded events must reach the review screen, including the final event.
    prompt = '场景：' + scene + '。只表现原书已有事件：' + '；'.join(events)
    if len(prompt) > 2000:
        raise PromptReviewError('单镜头场景及事件超过编辑长度限制，请依据原分析人工整理；未自动截断或删除情节。')
    return prompt


def video_prompt(guide, action):
    # Remove only exact system-authored instruction copies, not story vocabulary.
    action = action.replace(MOTION, '').strip('。； \n')
    identity = ('跨页固定外观（不作为本镜头新增人物或剧情）：' + guide + '。') if guide else ''
    prompt = (identity + '以本镜头原图核对人物身份、外观和场景；未出现的角色不得加入。'
              '仅表现本镜头已确认场景及事件：' + action + '。动画要求：' + MOTION)
    # This is a local safety bound, NOT a claimed provider moderation/length rule.
    if len(guide) > 2000 or len(action) > 2000 or len(prompt) > 6000:
        raise PromptReviewError('提示词超过本地完整性限制，请人工精简并重新确认；未截断内容，也未提交生成。')
    return prompt


def frozen_video_prompt(request, shot):
    """Preserve existing paid task snapshots; only new requests use format v3."""
    guide, action = request['story']['character_guide'], shot['prompt']
    version = request.get('motion_prompt_version')
    if version == 3:
        return video_prompt(guide, action)
    if version == 2:
        if action.endswith('。' + MOTION):
            action = action[:-len('。' + MOTION)]
        return '跨页统一角色设定：' + guide[:1500] + '。已确认本页动作：' + action[:1800] + '。动画要求：' + MOTION
    return ('跨页统一角色设定：' + guide + '。本页动作：' + action)[:4000]
