#!/usr/bin/env python3
"""Seed the restaurant catalog (locations, tables, dishes, waiters) into DynamoDB.

A freshly deployed backend has empty tables, so nothing can be booked or ordered.
This script adds just enough reference data to click through the app end to end:

    3 locations x (4 tables + 8 dishes + 1 waiter)

Users, reservations, orders and guest sessions are NOT seeded: create them through
the app (register -> Book a Table -> Pre-order -> Invite Link), so they are linked
to a real Cognito user and stored exactly the way the Lambda writes them.

Safe to re-run: ids are fixed and existing items are never overwritten
(a waiter's `reservations` list in particular stays intact).

Usage:
    python3 seed_catalog.py --dry-run            # print what would be written
    python3 seed_catalog.py                      # write to the default AWS profile/region
    python3 seed_catalog.py --region eu-north-1 --profile my-profile
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from decimal import Decimal

# Values stored as numbers, matching EnumAsIntConverter in the Lambda.
DISH_TYPE_APPETIZER, DISH_TYPE_MAIN_COURSE, DISH_TYPE_DESSERT = 0, 1, 2
DISH_STATE_AVAILABLE = 1

# Relative paths are served by the frontend itself (src/assets), both on `ng serve` and CloudFront.
DISH_IMAGES = [
    'assets/img/dishes/spring-salad.jpg',
    'assets/img/dishes/avocado-pine-nut-bowl.jpg',
    'assets/img/dishes/fresh-strawberry-mint-salad.jpg',
    'assets/img/dishes/roasted-sweet-potato-and-lentil-salad.jpg',
]

LOCATIONS = [
    {
        'slug': 'rustaveli',
        'address': 'Rustaveli Avenue 48',
        'description': 'Flagship restaurant in the heart of the city with a summer terrace.',
        'imageUrl': 'assets/img/locations/rustaveli-avenue-48.jpg',
        'rating': '4.8',
        'averageOccupancy': '75%',
    },
    {
        'slug': 'baratashvili',
        'address': 'Baratashvili Street 14',
        'description': 'Cozy place near the old town, popular for family dinners.',
        'imageUrl': 'assets/img/locations/baratashvili-street-14.jpg',
        'rating': '4.6',
        'averageOccupancy': '60%',
    },
    {
        'slug': 'abashidze',
        'address': 'Abashidze Street 9',
        'description': 'Quiet neighbourhood spot with a seasonal vegan menu.',
        'imageUrl': 'assets/img/locations/abashidze-street-9.jpg',
        'rating': '4.5',
        'averageOccupancy': '50%',
    },
]

TABLE_CAPACITIES = [2, 4, 6, 8]

# name, type, price, weight, calories, proteins, fats, carbohydrates, vitamins
DISHES = [
    ('Spring Salad', DISH_TYPE_APPETIZER, '12', '430 g', '350 kcal', '9 g', '18 g', '32 g', 'A, C, K'),
    ('Avocado Pine Nut Bowl', DISH_TYPE_MAIN_COURSE, '14.5', '380 g', '520 kcal', '12 g', '34 g', '40 g', 'E, K, B6'),
    ('Fresh Strawberry Mint Salad', DISH_TYPE_APPETIZER, '11', '350 g', '280 kcal', '5 g', '12 g', '36 g', 'C, B9'),
    ('Roasted Sweet Potato & Lentil Salad', DISH_TYPE_MAIN_COURSE, '13', '400 g', '460 kcal', '18 g', '14 g', '62 g', 'A, B1, Fe'),
    ('Grilled Salmon', DISH_TYPE_MAIN_COURSE, '24', '320 g', '540 kcal', '38 g', '30 g', '12 g', 'D, B12'),
    ('Mushroom Risotto', DISH_TYPE_MAIN_COURSE, '16.5', '350 g', '610 kcal', '14 g', '22 g', '84 g', 'B2, D'),
    ('Lemon Cheesecake', DISH_TYPE_DESSERT, '9', '150 g', '420 kcal', '7 g', '26 g', '38 g', 'A, B2'),
    ('Berry Sorbet', DISH_TYPE_DESSERT, '7', '120 g', '160 kcal', '1 g', '0 g', '38 g', 'C'),
]


def build_items():
    """Return {table_key: [items]} with deterministic ids (seed-...)."""
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    items = {'locations': [], 'tables': [], 'dishes': [], 'waiters': []}

    for location in LOCATIONS:
        location_id = f"seed-location-{location['slug']}"
        dish_ids = []

        for index, (name, dish_type, price, weight, calories, proteins, fats, carbs, vitamins) in enumerate(DISHES):
            dish_id = f"seed-dish-{location['slug']}-{index + 1}"
            dish_ids.append(dish_id)
            items['dishes'].append({
                'id': dish_id,
                'name': name,
                'description': f'{name} prepared fresh from seasonal ingredients.',
                'dishType': dish_type,
                'price': Decimal(price),
                'weight': weight,
                'calories': calories,
                'proteins': proteins,
                'fats': fats,
                'carbohydrates': carbs,
                'vitamins': vitamins,
                'imageUrl': DISH_IMAGES[index % len(DISH_IMAGES)],
                'state': DISH_STATE_AVAILABLE,
                'locationId': location_id,
            })

        for number, capacity in enumerate(TABLE_CAPACITIES, start=1):
            items['tables'].append({
                'id': f"seed-table-{location['slug']}-{number}",
                'locationId': location_id,
                'tableNumber': number,
                'capacity': capacity,
            })

        items['locations'].append({
            'id': location_id,
            'address': location['address'],
            'description': location['description'],
            'totalCapacity': sum(TABLE_CAPACITIES),
            'averageOccupancy': location['averageOccupancy'],
            'imageUrl': location['imageUrl'],
            'rating': Decimal(location['rating']),
            'specialtyDishIds': dish_ids[:3],
        })

        # Booking assigns the least busy waiter of the location and fails if there is none.
        # This placeholder is not a Cognito user, so nobody can sign in as it.
        items['waiters'].append({
            'userId': f"seed-waiter-{location['slug']}",
            'locationId': location_id,
            'createdAt': now,
            'reservations': [],
        })

    return items


KEY_ATTRIBUTE = {'locations': 'id', 'tables': 'id', 'dishes': 'id', 'waiters': 'userId'}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--region', help='AWS region (default: from the AWS profile)')
    parser.add_argument('--profile', help='AWS profile name (default: the default profile)')
    parser.add_argument('--locations-table', default='Locations')
    parser.add_argument('--tables-table', default='Tables')
    parser.add_argument('--dishes-table', default='Dishes')
    parser.add_argument('--waiters-table', default='Waiters')
    parser.add_argument('--dry-run', action='store_true', help='print the items instead of writing them')
    args = parser.parse_args()

    items = build_items()
    table_names = {
        'locations': args.locations_table,
        'tables': args.tables_table,
        'dishes': args.dishes_table,
        'waiters': args.waiters_table,
    }

    if args.dry_run:
        print(json.dumps({table_names[key]: value for key, value in items.items()}, indent=2, default=str))
        return 0

    import boto3
    from botocore.exceptions import ClientError

    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    dynamodb = session.resource('dynamodb')
    print(f'Seeding into region {session.region_name}')

    for key, records in items.items():
        table = dynamodb.Table(table_names[key])
        created = skipped = 0
        for record in records:
            try:
                table.put_item(
                    Item=record,
                    ConditionExpression='attribute_not_exists(#key)',
                    ExpressionAttributeNames={'#key': KEY_ATTRIBUTE[key]},
                )
                created += 1
            except ClientError as error:
                if error.response['Error']['Code'] != 'ConditionalCheckFailedException':
                    raise
                skipped += 1
        print(f'{table_names[key]:<12} created {created:>3}, already existed {skipped:>3}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
