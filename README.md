# 잿빛 심연

아홉 왕국을 지나 흑염의 끝에 닿는 던전 RPG. 기획·개발 김민석.

| 주소 | 내용 |
|---|---|
| `/` | 게임 |
| `/admin` | 관리자 페이지 (참여자 진행 상황 · 선물) |
| `/dex` | 도감 |

참여자가 링크로 들어와 게임을 하면 저장할 때마다 진행 상황이 서버로 자동 보고되고,
관리자가 `/admin`에서 보낸 선물은 참여자 게임에 자동으로 들어갑니다.

## 처음 한 번 설정

1. **GitHub 저장소** — 이 폴더의 내용을 `ashen-abyss` 저장소(Public)에 올립니다. `.github` 폴더도 함께 올라가야 서버 깨우기가 동작합니다.
2. **GitHub 토큰** — GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.
   Repository access는 `ashen-abyss`만, Permissions의 Contents를 Read and write로 둡니다.
   서버가 꺼졌다 켜져도 진행 기록이 남도록 `data` 브랜치에 암호화해서 백업하는 데 씁니다.
3. **Render** — render.com → New → Blueprint → `ashen-abyss` 저장소를 고르면 `render.yaml`대로 무료 서버가 만들어집니다. 환경 변수:
   - `ADMIN_KEY` 관리자 비밀번호 (관리자 페이지 로그인과 백업 암호에 씁니다. 바꾸면 이전 백업을 못 읽습니다)
   - `GH_TOKEN` 2번에서 만든 토큰
   - `GH_REPO` `깃허브아이디/ashen-abyss`
4. **서버 깨우기** — `.github/workflows/keepalive.yml`이 10분마다 `https://ashen-abyss.onrender.com/ping`을 부릅니다.
   주소가 바뀌면 저장소 변수 `SERVER_URL`(Settings → Secrets and variables → Actions → Variables)로 바꿀 수 있습니다.

지금 주소: https://ashen-abyss.onrender.com (게임) · /admin (관리자) · /dex (도감)

## 알아 둘 것

- Render 무료 서버는 15분 동안 접속이 없으면 잠듭니다. 서버 깨우기가 10분마다 신호를 보내 깨어 있게 합니다.
- GitHub은 60일 동안 저장소에 활동이 없으면 예약 실행을 멈춥니다. 진행 보고 백업이 `data` 브랜치에 계속 쌓이면 활동으로 칩니다. 멈추면 Actions 탭에서 다시 켜면 됩니다.
- 진행 보고 백업은 `ADMIN_KEY`로 암호화돼서 공개 저장소에 있어도 다른 사람이 읽을 수 없습니다.
- 서버 없이 `public/index.html`만 열어도 게임은 됩니다. 그때는 진행 보고 코드 · 선물 코드 방식으로 주고받습니다.
