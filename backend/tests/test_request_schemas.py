"""Request-model organization regressions; no database startup or model calls."""

import pytest
from pydantic import ValidationError

from app import main, schemas


@pytest.mark.parametrize("name", [
    "PageRevisionInput", "AssetInput", "SegmentInput", "InteractionInput", "RunLogInput",
])
def test_request_models_have_one_definition_and_keep_legacy_imports(name):
    model = getattr(schemas, name)
    assert model.__module__ == "app.schemas"
    assert getattr(main, name) is model


@pytest.mark.parametrize(("model", "payload", "field"), [
    (schemas.AssetInput, {"asset_type": "image", "file_path": "page.png", "mime_type": "image/png"}, "metadata"),
    (schemas.RunLogInput, {"level": "INFO", "event": "integration_check"}, "safe_metadata"),
])
def test_optional_mapping_defaults_are_not_shared(model, payload, field):
    first, second = model(**payload), model(**payload)
    getattr(first, field)["test"] = "one instance only"
    assert getattr(second, field) == {}


@pytest.mark.parametrize("model", [
    schemas.AssetInput, schemas.SegmentInput, schemas.InteractionInput, schemas.RunLogInput,
])
def test_required_fields_still_reject_empty_payload(model):
    with pytest.raises(ValidationError):
        model.model_validate({})


def test_page_revision_keeps_optional_fields():
    assert schemas.PageRevisionInput().model_dump() == {"ocr": None, "vision": None}
    # The route, not the schema, requires at least one supplied revision.


@pytest.mark.parametrize(("path", "method", "name"), [
    ("/api/books/{book_id}/pages/{page_no}/revision", "patch", "PageRevisionInput"),
    ("/api/runs/{run_id}/assets", "post", "AssetInput"),
    ("/api/runs/{run_id}/segments", "post", "SegmentInput"),
    ("/api/runs/{run_id}/interactions", "post", "InteractionInput"),
    ("/api/runs/{run_id}/logs", "post", "RunLogInput"),
])
def test_routes_keep_existing_request_schema_names(path, method, name):
    contract = main.app.openapi()
    body = contract["paths"][path][method]["requestBody"]["content"]["application/json"]
    assert body["schema"] == {"$ref": f"#/components/schemas/{name}"}
