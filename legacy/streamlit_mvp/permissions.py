def can_edit(user, project_status):
    if user["role"] == "admin":
        return True
    if project_status == "in_proofreading":
        return user["role"] == "proofreader"
    return user["role"] in ("author", "proofreader")
