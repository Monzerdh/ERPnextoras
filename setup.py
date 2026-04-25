from setuptools import find_packages, setup

with open("requirements.txt") as f:
	install_requires = [line.strip() for line in f.readlines() if line.strip()]

setup(
	name="munzer_app",
	version="0.0.1",
	description="Custom inventory tooling for ORAS — Item Master Report S",
	author="Monzerdh",
	author_email="Monzerdh@users.noreply.github.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires,
)
