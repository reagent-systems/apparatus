"""EC2 start and stop. The client is a fake; no account is called."""

import pytest

from apparatus_server.vm import (
    Ec2VmController,
    LocalVmController,
    VmUnavailable,
    instance_name,
    make_vm_controller,
)


def _inst(user_id: str, state: str, instance_id: str = "i-abc") -> dict:
    return {
        "InstanceId": instance_id,
        "State": {"Name": state},
        "Tags": [{"Key": "Name", "Value": instance_name(user_id)}],
    }


class FakeEc2:
    def __init__(self, instances: list[dict]):
        self.instances = instances
        self.started: list[str] = []
        self.stopped: list[str] = []

    def describe_instances(self, Filters, NextToken=None):
        name = None
        states = None
        for item in Filters:
            if item["Name"] == "tag:Name":
                name = item["Values"][0]
            if item["Name"] == "instance-state-name":
                states = set(item["Values"])
        found = []
        for inst in self.instances:
            tags = {tag["Key"]: tag["Value"] for tag in inst.get("Tags", [])}
            if name is not None and tags.get("Name") != name:
                continue
            if states is not None and inst["State"]["Name"] not in states:
                continue
            found.append(inst)
        return {"Reservations": [{"Instances": found}] if found else []}

    def start_instances(self, InstanceIds):
        self.started.extend(InstanceIds)

    def stop_instances(self, InstanceIds):
        self.stopped.extend(InstanceIds)


def test_instance_name_is_a_short_label():
    name = instance_name("Firebase UID_with.dots")
    assert name.startswith("apparatus-")
    assert len(name) <= 63
    assert name == name.lower()
    assert instance_name("Firebase UID_with.dots") == name


def test_ec2_requires_a_region():
    with pytest.raises(ValueError, match="EC2_REGION"):
        Ec2VmController("")
    with pytest.raises(ValueError, match="unknown vm controller"):
        make_vm_controller("nope", "", "")
    assert isinstance(make_vm_controller("local", "", ""), LocalVmController)
    made = make_vm_controller("ec2", "", "", "us-east-1")
    assert isinstance(made, Ec2VmController)
    assert made.region == "us-east-1"


async def test_status_maps_ec2_states():
    client = FakeEc2([_inst("alice", "running"), _inst("bob", "stopped", "i-bob")])
    ctl = Ec2VmController("us-east-1", client)
    assert await ctl.status("alice") == "RUNNING"
    assert await ctl.status("bob") == "TERMINATED"
    assert await ctl.status("carol") == "NOT_FOUND"


async def test_start_and_stop_call_the_api_once():
    client = FakeEc2([_inst("alice", "stopped"), _inst("bob", "running", "i-bob")])
    ctl = Ec2VmController("us-east-1", client)
    await ctl.start("alice")
    await ctl.start("bob")
    await ctl.stop("bob")
    await ctl.stop("alice")
    assert client.started == ["i-abc"]
    assert client.stopped == ["i-bob"]


async def test_start_of_a_missing_or_stopping_instance_fails():
    client = FakeEc2([_inst("alice", "stopping")])
    ctl = Ec2VmController("us-east-1", client)
    with pytest.raises(VmUnavailable, match="no EC2 instance"):
        await ctl.start("missing")
    with pytest.raises(VmUnavailable, match="stopping"):
        await ctl.start("alice")
    await ctl.stop("missing")
    assert client.stopped == []


async def test_two_instances_with_one_name_are_refused():
    client = FakeEc2([_inst("alice", "running", "i-1"), _inst("alice", "stopped", "i-2")])
    ctl = Ec2VmController("us-east-1", client)
    with pytest.raises(VmUnavailable, match="more than one"):
        await ctl.status("alice")


async def test_describe_follows_the_next_token():
    class Paged(FakeEc2):
        def describe_instances(self, Filters, NextToken=None):
            if NextToken is None:
                return {"Reservations": [], "NextToken": "page-2"}
            return super().describe_instances(Filters)

    client = Paged([_inst("alice", "running")])
    ctl = Ec2VmController("us-east-1", client)
    assert await ctl.status("alice") == "RUNNING"
