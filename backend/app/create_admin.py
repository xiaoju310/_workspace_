"""One-time administrator bootstrap; credentials are entered locally, never over HTTP."""
import argparse
import getpass

from pymongo.errors import DuplicateKeyError

from .accounts import accounts_db, create_user, initialize_accounts


def main():
    parser = argparse.ArgumentParser(description="Create the first administrator locally")
    parser.add_argument("--username", default="admin")
    args = parser.parse_args()
    initialize_accounts()
    if accounts_db().users.find_one({"role": "admin"}):
        raise SystemExit("管理员已存在；不会创建第二个或重置密码")
    password = getpass.getpass("管理员密码（至少12字符）: ")
    if password != getpass.getpass("再次输入密码: "):
        raise SystemExit("两次密码不一致；未创建账号")
    try:
        user = create_user(args.username, password, role="admin")
    except (ValueError, DuplicateKeyError) as exc:
        raise SystemExit(f"未创建账号: {exc}") from exc
    print(f"管理员账号创建成功：{user['username']}（密码不显示）")


if __name__ == "__main__":
    main()
